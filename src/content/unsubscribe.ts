import { isYouTubeChannelUrl, isYouTubeReturnUrl } from '../shared/backup-validate'

const PENDING_KEY = 'mytube-pending-unsub'
const BATCH_KEY = 'mytube-unsub-batch'
const RETURN_KEY = 'mytube-unsub-return'

interface PendingUnsub {
  channelUrl: string
}

interface BatchUnsub {
  urls: string[]
  total: number
  /** Last time the batch made progress (ms epoch). A batch idle for BATCH_TTL_MS is dropped. */
  updatedAt: number
}

// A batch normally advances every few seconds. One that has not moved for this
// long was abandoned (lost navigation, closed tab, ...) and must not be resumed
// by a later, unrelated unsubscribe of the same channel.
const BATCH_TTL_MS = 10 * 60 * 1000

export function triggerUnsubscribe(channelUrl: string): void {
  // Só navega para https://(www.)youtube.com. `organizable.url` vem do storage
  // (e, antes do validador, de backups); nunca é confiável para `location.href`.
  if (!isYouTubeChannelUrl(channelUrl)) {
    console.warn('[MyTube] Refusing to unsubscribe via non-YouTube URL')
    return
  }
  const targetPath = new URL(channelUrl).pathname

  if (window.location.pathname === targetPath || window.location.pathname.startsWith(targetPath + '/')) {
    void executeUnsubscribe(channelUrl)
    return
  }

  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ channelUrl }))
  window.location.href = channelUrl
}

export function triggerBatchUnsubscribe(requestedUrls: string[]): void {
  const channelUrls = requestedUrls.filter(isYouTubeChannelUrl)
  if (channelUrls.length === 0) return

  const batch: BatchUnsub = { urls: channelUrls, total: channelUrls.length, updatedAt: Date.now() }
  sessionStorage.setItem(BATCH_KEY, JSON.stringify(batch))
  sessionStorage.setItem(RETURN_KEY, window.location.href)

  const first = channelUrls[0]!
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ channelUrl: first }))
  window.location.href = first
}

function getBatchProgress(): { current: number; total: number } | null {
  const raw = sessionStorage.getItem(BATCH_KEY)
  if (!raw) return null
  try {
    const batch = JSON.parse(raw) as BatchUnsub
    return { current: batch.total - batch.urls.length, total: batch.total }
  } catch {
    return null
  }
}

function waitFor(selector: string, timeout = 5000): Promise<HTMLElement | null> {
  return new Promise(resolve => {
    const found = document.querySelector(selector) as HTMLElement | null
    if (found) return resolve(found)

    const obs = new MutationObserver(() => {
      const el = document.querySelector(selector) as HTMLElement | null
      if (el) { obs.disconnect(); resolve(el) }
    })
    obs.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => { obs.disconnect(); resolve(null) }, timeout)
  })
}

function clearBatch(): void {
  sessionStorage.removeItem(BATCH_KEY)
  sessionStorage.removeItem(RETURN_KEY)
}

// Reads the batch from sessionStorage, revalidating it: the tab's sessionStorage
// is also writable by the youtube.com page itself. An unreadable batch is dropped.
function readBatch(): BatchUnsub | null {
  const raw = sessionStorage.getItem(BATCH_KEY)
  if (!raw) return null
  try {
    const batch = JSON.parse(raw) as BatchUnsub
    // No timestamp (older build, or written by the page) counts as expired.
    const age = typeof batch.updatedAt === 'number' ? Date.now() - batch.updatedAt : Infinity
    if (!(age < BATCH_TTL_MS)) {
      clearBatch()
      return null
    }
    batch.urls = Array.isArray(batch.urls) ? batch.urls.filter(isYouTubeChannelUrl) : []
    return batch
  } catch {
    clearBatch()
    return null
  }
}

function channelPath(url: string): string {
  return new URL(url).pathname.replace(/\/+$/, '')
}

// The batch only moves when the channel just handled is the batch's current
// item. Anything else means the stored batch belongs to an earlier run.
function isBatchHead(batch: BatchUnsub, channelUrl: string): boolean {
  const head = batch.urls[0]
  return !!head && isYouTubeChannelUrl(channelUrl) && channelPath(head) === channelPath(channelUrl)
}

// Drops the current item and goes to the next one, or finishes the batch.
function continueBatch(batch: BatchUnsub): void {
  batch.urls.shift()

  if (batch.urls.length === 0) {
    sessionStorage.removeItem(BATCH_KEY)
    const returnUrl = sessionStorage.getItem(RETURN_KEY)
    sessionStorage.removeItem(RETURN_KEY)
    console.log(`[MyTube] Batch unsubscribe complete (${batch.total} channels)`)
    setTimeout(() => {
      window.location.href = isYouTubeReturnUrl(returnUrl) ? returnUrl : 'https://www.youtube.com'
    }, 800)
    return
  }

  batch.updatedAt = Date.now()
  sessionStorage.setItem(BATCH_KEY, JSON.stringify(batch))
  const next = batch.urls[0]!
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ channelUrl: next }))
  console.log(`[MyTube] Batch unsubscribe: ${batch.total - batch.urls.length}/${batch.total}`)
  setTimeout(() => {
    window.location.href = next
  }, 800)
}

function afterUnsubscribe(channelUrl: string): void {
  const batch = readBatch()
  if (!batch) {
    setTimeout(() => history.back(), 800)
    return
  }

  if (!isBatchHead(batch, channelUrl)) {
    // Left over from a run that stalled: do not resume it.
    clearBatch()
    setTimeout(() => history.back(), 800)
    return
  }

  continueBatch(batch)
}

// `executeUnsubscribe` ended without unsubscribing `channelUrl`. A batch must not
// stay in sessionStorage for a later, unrelated unsubscribe to pick up. When the
// channel was simply already unsubscribed, the batch moves on to its next item;
// on any failure it is abandoned.
function settleBatchWithoutUnsubscribe(channelUrl: string, skip: boolean): void {
  const batch = readBatch()
  if (!batch) return
  if (skip && isBatchHead(batch, channelUrl)) {
    continueBatch(batch)
    return
  }
  clearBatch()
}

async function executeUnsubscribe(channelUrl: string): Promise<void> {
  const container = await waitFor(
    'ytd-subscribe-button-renderer, yt-subscribe-button-view-model',
    4000,
  )
  if (!container) {
    console.warn('[MyTube] Subscribe button container not found')
    settleBatchWithoutUnsubscribe(channelUrl, false)
    return
  }

  const btn = container.querySelector('button') as HTMLElement | null
  if (!btn) {
    console.warn('[MyTube] Subscribe button not found')
    settleBatchWithoutUnsubscribe(channelUrl, false)
    return
  }

  const isSubscribed = btn.hasAttribute('subscribed')
    || btn.getAttribute('aria-label')?.toLowerCase().includes('unsubscribe')
    || btn.getAttribute('aria-label')?.toLowerCase().includes('inscrit')
    || container.hasAttribute('subscribed')
    || container.querySelector('[subscribed]') !== null

  if (!isSubscribed) {
    console.log('[MyTube] Channel not subscribed, skipping')
    settleBatchWithoutUnsubscribe(channelUrl, true)
    return
  }

  btn.click()

  const dialog = await waitFor(
    'tp-yt-paper-dialog:not([aria-hidden="true"]), yt-confirm-dialog-renderer, ytd-popup-container tp-yt-paper-dialog',
    3000,
  )

  if (dialog) {
    const confirmBtn = dialog.querySelector(
      '#confirm-button button, #confirm-button yt-button-renderer button, [slot="primaryAction"] button',
    ) as HTMLElement | null

    if (confirmBtn) {
      confirmBtn.click()
      console.log('[MyTube] Unsubscribed successfully')
      afterUnsubscribe(channelUrl)
      return
    }
  }

  const menuItem = await waitFor(
    'tp-yt-paper-item, ytd-menu-service-item-renderer, tp-yt-paper-listbox tp-yt-paper-item',
    2000,
  )
  if (menuItem) {
    const items = document.querySelectorAll(
      'tp-yt-paper-item, ytd-menu-service-item-renderer, tp-yt-paper-listbox tp-yt-paper-item',
    )
    for (const item of items) {
      const text = (item as HTMLElement).textContent?.trim().toLowerCase() ?? ''
      if (text.includes('unsubscribe') || text.includes('cancelar inscri') || text.includes('desinscrever')) {
        ;(item as HTMLElement).click()
        break
      }
    }

    const confirmDialog = await waitFor(
      'tp-yt-paper-dialog:not([aria-hidden="true"]) #confirm-button button',
      3000,
    )
    if (confirmDialog) {
      ;(confirmDialog as HTMLElement).click()
      console.log('[MyTube] Unsubscribed successfully (via menu)')
      afterUnsubscribe(channelUrl)
      return
    }
  }

  console.warn('[MyTube] Could not confirm the unsubscribe')
  settleBatchWithoutUnsubscribe(channelUrl, false)
}

async function checkPending(): Promise<void> {
  const raw = sessionStorage.getItem(PENDING_KEY)
  if (!raw) return

  let pending: PendingUnsub
  try {
    pending = JSON.parse(raw) as PendingUnsub
  } catch {
    sessionStorage.removeItem(PENDING_KEY)
    return
  }

  sessionStorage.removeItem(PENDING_KEY)
  // The pending URL is what we navigated to; sessionStorage is also writable by
  // the page, so it is revalidated before it identifies the channel.
  if (!isYouTubeChannelUrl(pending?.channelUrl)) {
    clearBatch()
    return
  }
  await executeUnsubscribe(pending.channelUrl)
}

document.addEventListener('yt-navigate-finish', () => {
  setTimeout(() => void checkPending(), 1500)
})

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => void checkPending(), 1500))
} else {
  setTimeout(() => void checkPending(), 1500)
}
