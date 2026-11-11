import * as storage from '../shared/storage'
import * as db from '../shared/db'
import type { MessageType, MessageResponse } from '../shared/types'
import { handleWatchMessage, isWatchMessage } from './watch-history'
import { pollNewVideos, fetchFolderFeed, fetchHomeFeed } from './channel-poller'
import { getAIConfig, saveAIConfig, sanitizeConfig, purgeLegacyAIStorage, OPENAI_OAUTH_BASE_URL } from '../shared/ai/storage'
import { beginDeviceAuth } from '../shared/ai/device-auth'
import { exchangeDeviceCode, validTokens } from './ai/openai-oauth'
import { listModels as aiListModels, testProvider } from './ai'
import { categorize } from './ai/categorize'
import type { AIProvider } from '../shared/ai/types'
import {
  endpointProblem,
  normalizeEndpointUrl,
  originFromUrl,
  type PermissionOutcome,
} from '../shared/ai/host-permission'

// A config antiga de IA (com a chave) saía de chrome.storage.local — legível pelo
// content script. A migração roda a cada partida do worker, não só na instalação.
void purgeLegacyAIStorage().catch(err => {
  console.error('[MyTube] AI credential migration failed:', err)
})

const ALARM_NAME = 'rss-poll'
const ALARM_PERIOD_MINUTES = 30

// ── Alarm setup ──────────────────────────────────────────────────────────────

function setupAlarm(): void {
  chrome.alarms.get(ALARM_NAME, existing => {
    if (!existing) {
      chrome.alarms.create(ALARM_NAME, {
        delayInMinutes: ALARM_PERIOD_MINUTES,
        periodInMinutes: ALARM_PERIOD_MINUTES,
      })
    }
  })
}

chrome.runtime.onInstalled.addListener(() => {
  setupAlarm()
  void pollNewVideos()
})

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SIDEBAR' }).catch(() => {})
  }
})

chrome.runtime.onStartup.addListener(() => {
  setupAlarm()
  void pollNewVideos()
})

// ── Alarm handler ─────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME || alarm.name === 'channel-poll-continue') {
    (async () => {
      try {
        await pollNewVideos()
      } catch (err) {
        console.error('[MyTube] RSS poll failed:', err)
      }
    })()
  }
})

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: MessageType,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse<MessageType['type']>) => void
  ) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch(err => {
        console.error('[MyTube] Message handler error:', err)
        sendResponse(getErrorFallback(message.type) as MessageResponse<MessageType['type']>)
      })

    // Return true to keep the message channel open for the async response
    return true
  }
)

function getErrorFallback(type: MessageType['type']): unknown {
  switch (type) {
    case 'GET_STATE':
      return { organizables: [], folders: [], tags: [], newVideoCounts: {} }
    case 'GET_FOLDER_FEED':
      return []
    case 'GET_HOME_FEED':
      return []
    case 'GET_NEW_VIDEO_COUNTS':
      return {}
    case 'GET_HOME_NUDGE_DATA':
      return { total: 0, folders: [] }
    case 'GET_CHANNEL_INFO':
      return null
    case 'AI_LIST_PROVIDERS':
      return { providers: [], activeProviderId: null }
    case 'AI_LIST_MODELS':
      return []
    case 'AI_SAVE_PROVIDER':
      return { ok: false, error: 'internal-error' }
    case 'AI_TEST_PROVIDER':
      return { ok: false, error: 'internal-error' }
    case 'AI_OAUTH_BEGIN':
      return { ok: false, error: 'internal-error' }
    case 'AI_OAUTH_COMPLETE':
      return { ok: false, error: 'internal-error' }
    case 'AI_CATEGORIZE':
      return { ok: false, error: 'internal-error' }
    case 'AI_REQUEST_HOST_PERMISSION':
      // Falha do próprio roteador não é o usuário recusando.
      return { outcome: 'cannot-request' }
    default:
      return { ok: false }
  }
}

/**
 * Renova o token OAuth sob demanda (sem timer) e PERSISTE o resultado: sem gravar,
 * o obtainedAt nunca avança — toda chamada depois de 45 min renova de novo — e o
 * refresh_token rotacionado é descartado, matando a sessão na renovação seguinte.
 * Re-lê o config imediatamente antes de gravar para não sobrescrever uma alteração
 * concorrente (ex.: troca de modelo).
 */
async function freshProvider(provider: AIProvider): Promise<AIProvider> {
  if (provider.kind !== 'openai-oauth' || !provider.tokens) return provider
  const tokens = await validTokens(provider.tokens)
  if (
    tokens.accessToken === provider.tokens.accessToken &&
    tokens.obtainedAt === provider.tokens.obtainedAt
  ) return provider
  const config = await getAIConfig()
  const idx = config.providers.findIndex(p => p.id === provider.id)
  if (idx !== -1) {
    config.providers[idx] = { ...config.providers[idx], tokens }
    await saveAIConfig(config)
  }
  return { ...provider, tokens }
}

// ── Host permission dialog ────────────────────────────────────────────────────

/**
 * `chrome.permissions.request` não existe no mundo isolado do content script, e
 * a interface do app é a sidebar. Então o aceite — e só ele — vira uma janelinha
 * de propósito único. Quem pediu fica esperando a resposta desta mensagem: é o
 * background que entrega o desfecho, pela mesma porta em que o pedido entrou.
 */
const pendingHostPermission = new Map<
  string,
  { resolve: (outcome: PermissionOutcome) => void; windowId?: number }
>()
let hostPermissionSeq = 0

function settleHostPermission(requestId: string, outcome: PermissionOutcome): void {
  const pending = pendingHostPermission.get(requestId)
  if (!pending) return
  pendingHostPermission.delete(requestId)
  pending.resolve(outcome)
}

async function requestHostPermission(
  rawUrl: string,
  tabId: number | undefined
): Promise<PermissionOutcome> {
  const normalized = normalizeEndpointUrl(rawUrl)
  const origin = normalized ? originFromUrl(normalized) : null
  if (!origin) return 'invalid-url'

  // O id da aba que pediu vai no requestId — e portanto na URL da janelinha —
  // para que duas abas pedindo ao mesmo tempo não se confundam.
  const requestId = `${tabId ?? 'x'}-${++hostPermissionSeq}`
  const url = chrome.runtime.getURL(
    `permission/index.html?origin=${encodeURIComponent(origin)}&request=${encodeURIComponent(requestId)}`
  )

  return await new Promise<PermissionOutcome>(resolve => {
    pendingHostPermission.set(requestId, { resolve })
    chrome.windows
      .create({ url, type: 'popup', width: 460, height: 340, focused: true })
      .then(win => {
        const pending = pendingHostPermission.get(requestId)
        if (pending) pending.windowId = win?.id
      })
      .catch(() => { settleHostPermission(requestId, 'cannot-request') })
  })
}

/** Fechar a janelinha sem decidir é recusa — sem isto a sidebar esperaria para sempre. */
chrome.windows.onRemoved.addListener(windowId => {
  for (const [requestId, pending] of pendingHostPermission) {
    if (pending.windowId === windowId) settleHostPermission(requestId, 'denied')
  }
})

/**
 * Veio de uma página da extensão (aikey/, dashboard, permission) e não de um
 * content script? O content script tem o mesmo `sender.id`, mas `sender.url` é a
 * página do youtube.com; só página da extensão tem URL no esquema da extensão.
 */
function isExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id
    && typeof sender.url === 'string'
    && sender.url.startsWith(chrome.runtime.getURL(''))
}

/** Forma comparável de um endereço: "https://X/v1" e "https://x/v1" são o mesmo destino. */
function comparableUrl(raw: string): string {
  return normalizeEndpointUrl(raw) ?? raw.trim()
}

async function handleMessage(
  message: MessageType,
  sender: chrome.runtime.MessageSender
): Promise<MessageResponse<MessageType['type']>> {
  // Backup do histórico de exibição (bloco próprio, ver watch-history.ts).
  if (isWatchMessage(message)) {
    return (await handleWatchMessage(message, db)) as MessageResponse<MessageType['type']>
  }

  switch (message.type) {
    case 'ADD_WATCH_ENTRY': {
      await db.addWatchEntry(message.payload)
      return { ok: true }
    }

    case 'ADD_ORGANIZABLE': {
      const organizable = await storage.addOrganizable(message.payload)
      // addOrganizable returns Organizable, but caller expects { ok: boolean }
      void organizable
      return { ok: true }
    }

    case 'UPDATE_ORGANIZABLE': {
      await storage.updateOrganizable(message.payload)
      return { ok: true }
    }

    case 'DELETE_ORGANIZABLE': {
      const toDelete = (await storage.getState()).organizables.find(
        o => o.id === message.payload.id
      )
      await storage.deleteOrganizable(message.payload.id)
      if (toDelete?.type === 'channel') {
        await db.markChannelSeen(toDelete.youtubeId, Date.now())
      }
      return { ok: true }
    }

    case 'GET_STATE': {
      const state = await storage.getState()
      const newVideoCounts = await db.getNewVideoCountsMap()
      return { ...state, newVideoCounts }
    }

    case 'SYNC_SUBSCRIPTIONS': {
      await storage.syncOrganizables(message.payload)
      setTimeout(() => void pollNewVideos(), 2000)
      return { ok: true }
    }

    case 'SYNC_PLAYLISTS': {
      await storage.syncOrganizables(message.payload)
      return { ok: true }
    }

    case 'RESET_BADGE': {
      await db.markAllSeen(Date.now())
      chrome.action.setBadgeText({ text: '' })
      return { ok: true }
    }

    case 'GET_NEW_VIDEO_COUNTS': {
      return await db.getNewVideoCountsMap()
    }

    case 'MARK_CHANNEL_READ': {
      await db.markChannelSeen(message.payload.channelId, Date.now())
      const counts = await db.getNewVideoCountsMap()
      const total = Object.values(counts).reduce((s, c) => s + c, 0)
      chrome.action.setBadgeText({ text: total > 0 ? String(total) : '' })
      return { ok: true }
    }

    case 'MARK_ALL_READ': {
      await db.markAllSeen(Date.now())
      chrome.action.setBadgeText({ text: '' })
      return { ok: true }
    }

    case 'MARK_FOLDER_READ': {
      const state = await storage.getState()
      const { folderId } = message.payload
      const folderIds = new Set<string>([folderId])
      let added = true
      while (added) {
        added = false
        for (const f of state.folders) {
          if (f.parentId && folderIds.has(f.parentId) && !folderIds.has(f.id)) {
            folderIds.add(f.id)
            added = true
          }
        }
      }
      const channelIds = state.organizables
        .filter(o => o.type === 'channel' && o.folderId && folderIds.has(o.folderId))
        .map(o => o.youtubeId)
      for (const id of channelIds) {
        await db.markChannelSeen(id, Date.now())
      }
      const counts = await db.getNewVideoCountsMap()
      const total = Object.values(counts).reduce((s, c) => s + c, 0)
      chrome.action.setBadgeText({ text: total > 0 ? String(total) : '' })
      return { ok: true }
    }

    case 'MUTE_ALL_CHANNELS': {
      const changed = await storage.updateState(state => {
        let n = 0
        for (const o of state.organizables) {
          if (o.type === 'channel' && !o.muted) {
            o.muted = true
            n++
          }
        }
        return n > 0 ? n : storage.UNCHANGED
      })
      if (changed) {
        await db.markAllSeen(Date.now())
        chrome.action.setBadgeText({ text: '' })
      }
      return { ok: true }
    }

    case 'GET_FOLDER_FEED': {
      return await fetchFolderFeed(message.payload.folderId)
    }

    case 'GET_HOME_FEED': {
      return await fetchHomeFeed(message.payload.mode, message.payload.latestCount)
    }

    case 'GET_HOME_NUDGE_DATA': {
      const state = await storage.getState()
      const counts = await db.getNewVideoCountsMap()
      const folderMap = new Map<string, { name: string; color: string; count: number }>()
      for (const o of state.organizables) {
        if (o.type !== 'channel' || !o.folderId || o.muted) continue
        const c = counts[o.youtubeId] ?? 0
        if (c === 0) continue
        const folder = state.folders.find(f => f.id === o.folderId)
        if (!folder) continue
        const existing = folderMap.get(folder.id)
        if (existing) {
          existing.count += c
        } else {
          folderMap.set(folder.id, { name: folder.name, color: folder.color, count: c })
        }
      }
      const folders = [...folderMap.values()].sort((a, b) => b.count - a.count)
      const total = folders.reduce((s, f) => s + f.count, 0)
      return { total, folders }
    }

    case 'GET_CHANNEL_INFO': {
      const organizable = await storage.getOrganizableByYoutubeId(
        message.payload.channelId,
        'channel'
      )
      return organizable
    }

    case 'REMOVE_WATCH_ENTRY': {
      await db.removeWatchEntries(message.payload.videoId)
      return { ok: true }
    }

    case 'AI_LIST_PROVIDERS': {
      return sanitizeConfig(await getAIConfig())
    }

    case 'AI_SAVE_PROVIDER': {
      const incoming = message.payload
      // A chave só entra por uma página da extensão (aikey/). O content script
      // do youtube.com — onde a sidebar roda — nunca a digita nem a manda.
      if ((incoming.apiKey || incoming.tokens) && !isExtensionPage(sender)) {
        return { ok: false, error: 'forbidden-sender' }
      }
      const config = await getAIConfig()
      const idx = config.providers.findIndex(p => p.id === incoming.id)
      const prev = idx === -1 ? undefined : config.providers[idx]
      // Só o device flow (AI_OAUTH_COMPLETE) cria provedor OAuth; um save nunca
      // cria nem muda o tipo.
      if (!prev && incoming.kind !== 'api-key') return { ok: false, error: 'forbidden-kind' }
      // Um save nunca cria por engano: id desconhecido só passa com intenção explícita
      // de criar (o fluxo Adicionar). Sem isto, salvar numa janela de chave aberta
      // antes de o provedor ser removido na sidebar o recriaria.
      if (!prev && incoming.intent !== 'create') return { ok: false, error: 'provider-not-found' }

      let record: AIProvider
      if (prev?.kind === 'openai-oauth') {
        // Endereço e tokens do OAuth são fixos: rótulo e modelo são tudo o que um save muda.
        record = {
          ...prev,
          label: incoming.label,
          model: incoming.model !== undefined ? incoming.model : prev.model,
          baseUrl: OPENAI_OAUTH_BASE_URL,
        }
      } else {
        // O endereço é validado AQUI, não só no formulário: o worker é quem envia a
        // credencial. Um endereço já gravado e inalterado passa mesmo que hoje seja
        // recusado (provedor http:// antigo), para o seletor de modelo não quebrar.
        const sameAsStored = prev !== undefined && comparableUrl(prev.baseUrl) === comparableUrl(incoming.baseUrl)
        const normalized = sameAsStored ? prev.baseUrl : normalizeEndpointUrl(incoming.baseUrl)
        if (!normalized) return { ok: false, error: endpointProblem(incoming.baseUrl) ?? 'invalid-url' }
        // A credencial e o modelo pertencem ao DESTINO para o qual foram dados:
        // trocou o endereço, perdem o dono — a não ser que o mesmo save traga uma
        // chave nova. Sem isto, um save com o id de um provedor existente e a URL
        // de outro servidor faria o worker mandar a chave guardada para lá.
        const rebound = prev !== undefined && !sameAsStored
        const apiKey = incoming.apiKey || (rebound ? undefined : prev?.apiKey)
        record = {
          id: incoming.id,
          label: incoming.label,
          kind: 'api-key',
          baseUrl: normalized,
          model: rebound ? null : incoming.model !== undefined ? incoming.model : prev?.model ?? null,
          ...(apiKey ? { apiKey } : {}),
        }
      }

      if (idx === -1) config.providers.push(record)
      else config.providers[idx] = record
      if (!config.activeProviderId) config.activeProviderId = record.id
      await saveAIConfig(config)
      return { ok: true }
    }

    case 'AI_OPEN_KEY_PAGE': {
      const provider = message.payload.id ? `?provider=${encodeURIComponent(message.payload.id)}` : ''
      try {
        await chrome.windows.create({
          url: chrome.runtime.getURL(`aikey/index.html${provider}`),
          type: 'popup', width: 480, height: 560, focused: true,
        })
        return { ok: true }
      } catch {
        return { ok: false, error: 'cannot-open' }
      }
    }

    case 'AI_DELETE_PROVIDER': {
      const config = await getAIConfig()
      config.providers = config.providers.filter(p => p.id !== message.payload.id)
      if (config.activeProviderId === message.payload.id) {
        config.activeProviderId = config.providers[0]?.id ?? null
      }
      await saveAIConfig(config)
      return { ok: true }
    }

    case 'AI_SET_ACTIVE_PROVIDER': {
      const config = await getAIConfig()
      config.activeProviderId = message.payload.id
      await saveAIConfig(config)
      return { ok: true }
    }

    case 'AI_TEST_PROVIDER': {
      const config = await getAIConfig()
      const provider = config.providers.find(p => p.id === message.payload.id)
      if (!provider) return { ok: false, error: 'provider-not-found' }
      try {
        return await testProvider(await freshProvider(provider))
      } catch (err) {
        // Falha de renovação tem mensagem própria ("precisa conectar de novo") —
        // não deixa cair no fallback genérico do roteador.
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    case 'AI_LIST_MODELS': {
      const config = await getAIConfig()
      const provider = config.providers.find(p => p.id === message.payload.id)
      if (!provider) return []
      try {
        return await aiListModels(await freshProvider(provider))
      } catch {
        return []
      }
    }

    case 'AI_OAUTH_BEGIN': {
      return await beginDeviceAuth()
    }

    case 'AI_OAUTH_COMPLETE': {
      // O authorization_code é de uso único: se a troca falhar, a UI precisa do
      // código de erro para não terminar em painel vazio e silencioso.
      let tokens
      try {
        tokens = await exchangeDeviceCode(message.payload.code)
      } catch (err) {
        console.error('[MyTube] OAuth code exchange failed:', err)
        return { ok: false, error: 'oauth-exchange-failed' }
      }
      const config = await getAIConfig()
      const existing = config.providers.find(p => p.kind === 'openai-oauth')
      if (existing) {
        existing.tokens = tokens
        existing.label = message.payload.label
      } else {
        const provider = {
          id: crypto.randomUUID(),
          label: message.payload.label,
          kind: 'openai-oauth' as const,
          baseUrl: OPENAI_OAUTH_BASE_URL,
          model: null,
          tokens,
        }
        config.providers.push(provider)
        if (!config.activeProviderId) config.activeProviderId = provider.id
      }
      await saveAIConfig(config)
      return { ok: true }
    }

    case 'AI_CATEGORIZE': {
      const config = await getAIConfig()
      const provider = config.providers.find(p => p.id === config.activeProviderId)
      // Os dois motivos são acionáveis e diferentes — sem provedor o usuário
      // precisa conectar, sem modelo precisa testar e escolher um.
      if (!provider) return { ok: false, error: 'no-active-provider' }
      if (!provider.model) return { ok: false, error: 'no-model' }
      try {
        const suggestions = await categorize(
          await freshProvider(provider),
          message.payload.items,
          message.payload.folders,
          message.payload.tags ?? [],
        )
        return { ok: true, suggestions, provider: provider.label, model: provider.model }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    case 'AI_REQUEST_HOST_PERMISSION': {
      return { outcome: await requestHostPermission(message.payload.url, sender.tab?.id) }
    }

    case 'AI_HOST_PERMISSION_RESULT': {
      settleHostPermission(message.payload.requestId, message.payload.outcome)
      return { ok: true }
    }

    case 'OPEN_OPTIONS_PAGE': {
      // openOptionsPage só existe no service worker — o content script pede por mensagem.
      await chrome.runtime.openOptionsPage()
      return { ok: true }
    }

    default: {
      const _exhaustive: never = message
      console.warn('[MyTube] Unknown message type:', (_exhaustive as MessageType).type)
      return { ok: false }
    }
  }
}
