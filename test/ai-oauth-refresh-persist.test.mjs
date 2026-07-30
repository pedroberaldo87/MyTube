import assert from 'node:assert/strict'

// INVARIANTE: token renovado é persistido. Depois de uma renovação o store contém o
// novo accessToken/refreshToken/obtainedAt, e a chamada seguinte dentro da janela de
// 45 min NÃO dispara outro POST /oauth/token.

const AI_KEY = 'mytube-ai-providers'
const HOUR_MS = 60 * 60 * 1000

const store = {
  [AI_KEY]: {
    providers: [{
      id: 'p1',
      label: 'ChatGPT',
      kind: 'openai-oauth',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      model: null,
      tokens: {
        accessToken: 'AT-VELHO',
        refreshToken: 'RT-VELHO',
        obtainedAt: Date.now() - HOUR_MS,
      },
    }],
    activeProviderId: 'p1',
  },
}

let listener = null
let tokenPosts = 0
const modelAuthHeaders = []

const noopEvent = { addListener() {} }
globalThis.chrome = {
  alarms: { get(_name, cb) { cb(undefined) }, create() {}, onAlarm: noopEvent },
  action: { onClicked: noopEvent, setBadgeText() {} },
  tabs: { async sendMessage() {} },
  // O background escuta o fechamento da janelinha de permissão no import.
  windows: { onRemoved: noopEvent, async create() { return {} } },
  runtime: {
    onInstalled: noopEvent,
    onStartup: noopEvent,
    onMessage: { addListener(fn) { listener = fn } },
    async openOptionsPage() {},
  },
  storage: {
    local: {
      // chrome.storage serializa: o handler nunca recebe a referência do store.
      async get(key) { return key in store ? { [key]: structuredClone(store[key]) } : {} },
      async set(obj) { for (const [k, v] of Object.entries(obj)) store[k] = structuredClone(v) },
    },
  },
}

globalThis.fetch = async (url, init = {}) => {
  const u = String(url)
  if (u.endsWith('/oauth/token')) {
    tokenPosts++
    return {
      ok: true,
      status: 200,
      async json() {
        return { access_token: 'AT-NOVO', refresh_token: 'RT-ROTACIONADO' }
      },
    }
  }
  if (u.includes('/models')) {
    modelAuthHeaders.push(init.headers?.Authorization)
    return {
      ok: true,
      status: 200,
      async json() { return { models: [{ slug: 'gpt-5', priority: 1 }] } },
    }
  }
  throw new Error(`URL inesperada no teste: ${u}`)
}

await import('../src/background/index.ts')
assert.equal(typeof listener, 'function', 'o roteador não registrou chrome.runtime.onMessage')

function send(message) {
  return new Promise(resolve => { listener(message, {}, resolve) })
}

// 1. token expirado (60 min) → renova, usa o novo token e PERSISTE
const models = await send({ type: 'AI_LIST_MODELS', payload: { id: 'p1' } })
assert.deepEqual(models, ['gpt-5'], 'AI_LIST_MODELS não devolveu os modelos do Codex')
assert.equal(tokenPosts, 1, 'não renovou o token expirado')
assert.deepEqual(modelAuthHeaders, ['Bearer AT-NOVO'], 'chamou /models sem o token renovado')

const saved = store[AI_KEY].providers[0].tokens
assert.equal(saved.accessToken, 'AT-NOVO', 'access_token renovado não foi persistido no store')
assert.equal(
  saved.refreshToken, 'RT-ROTACIONADO',
  'refresh_token rotacionado foi descartado — a sessão morre na renovação seguinte'
)
assert.ok(
  Date.now() - saved.obtainedAt < 5000,
  'obtainedAt não avançou — toda chamada seguinte vai renovar de novo'
)

// 2. chamada seguinte dentro da janela de 45 min → nenhum POST /oauth/token extra
const test = await send({ type: 'AI_TEST_PROVIDER', payload: { id: 'p1' } })
assert.equal(test.ok, true, `AI_TEST_PROVIDER falhou: ${test.error}`)
assert.equal(test.modelCount, 1)
assert.equal(
  tokenPosts, 1,
  'chamada dentro da janela de 45 min disparou outro POST /oauth/token'
)
assert.deepEqual(
  modelAuthHeaders, ['Bearer AT-NOVO', 'Bearer AT-NOVO'],
  'segunda chamada não usou o token persistido'
)

// 3. o provedor persistido não perde os outros campos
const provider = store[AI_KEY].providers[0]
assert.equal(provider.id, 'p1')
assert.equal(provider.label, 'ChatGPT')
assert.equal(provider.kind, 'openai-oauth')
assert.equal(store[AI_KEY].activeProviderId, 'p1')

console.log('✓ ai-oauth-refresh-persist: 13 asserções passaram')
