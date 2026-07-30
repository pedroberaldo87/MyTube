const PENDING_KEY = 'mytube-pending-unsub'
const BATCH_KEY = 'mytube-unsub-batch'
const RETURN_KEY = 'mytube-unsub-return'

interface PendingUnsub {
  channelUrl: string
}

interface BatchUnsub {
  urls: string[]
  total: number
}

export function triggerUnsubscribe(channelUrl: string): void {
  const targetPath = new URL(channelUrl).pathname

  if (window.location.pathname === targetPath || window.location.pathname.startsWith(targetPath + '/')) {
    void executeUnsubscribe()
    return
  }

  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ channelUrl }))
  window.location.href = channelUrl
}

export function triggerBatchUnsubscribe(channelUrls: string[]): void {
  if (channelUrls.length === 0) return

  const batch: BatchUnsub = { urls: channelUrls, total: channelUrls.length }
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

function afterUnsubscribe(): void {
  const raw = sessionStorage.getItem(BATCH_KEY)
  if (!raw) {
    setTimeout(() => history.back(), 800)
    return
  }

  let batch: BatchUnsub
  try {
    batch = JSON.parse(raw) as BatchUnsub
  } catch {
    sessionStorage.removeItem(BATCH_KEY)
    sessionStorage.removeItem(RETURN_KEY)
    setTimeout(() => history.back(), 800)
    return
  }

  batch.urls.shift()

  if (batch.urls.length === 0) {
    sessionStorage.removeItem(BATCH_KEY)
    const returnUrl = sessionStorage.getItem(RETURN_KEY)
    sessionStorage.removeItem(RETURN_KEY)
    console.log(`[MyTube] Batch unsubscribe complete (${batch.total} channels)`)
    setTimeout(() => {
      window.location.href = returnUrl || 'https://www.youtube.com'
    }, 800)
    return
  }

  sessionStorage.setItem(BATCH_KEY, JSON.stringify(batch))
  const next = batch.urls[0]!
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ channelUrl: next }))
  console.log(`[MyTube] Batch unsubscribe: ${batch.total - batch.urls.length}/${batch.total}`)
  setTimeout(() => {
    window.location.href = next
  }, 800)
}

async function executeUnsubscribe(): Promise<void> {
  const container = await waitFor(
    'ytd-subscribe-button-renderer, yt-subscribe-button-view-model',
    4000,
  )
  if (!container) {
    console.warn('[MyTube] Subscribe button container not found')
    return
  }

  const btn = container.querySelector('button') as HTMLElement | null
  if (!btn) {
    console.warn('[MyTube] Subscribe button not found')
    return
  }

  const isSubscribed = btn.hasAttribute('subscribed')
    || btn.getAttribute('aria-label')?.toLowerCase().includes('unsubscribe')
    || btn.getAttribute('aria-label')?.toLowerCase().includes('inscrit')
    || container.hasAttribute('subscribed')
    || container.querySelector('[subscribed]') !== null

  if (!isSubscribed) {
    console.log('[MyTube] Channel not subscribed, skipping')
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
      afterUnsubscribe()
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
      afterUnsubscribe()
    }
  }
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
  await executeUnsubscribe()
}

document.addEventListener('yt-navigate-finish', () => {
  setTimeout(() => void checkPending(), 1500)
})

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => void checkPending(), 1500))
} else {
  setTimeout(() => void checkPending(), 1500)
}
