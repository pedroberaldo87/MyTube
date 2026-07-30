import assert from 'node:assert/strict'
import { t } from '../src/shared/i18n.ts'

// INVARIANTE: falha na troca do código nunca produz estado vazio silencioso.
// AI_OAUTH_COMPLETE responde { ok:false, error } com código traduzível e não grava provedor.

const AI_KEY = 'mytube-ai-providers'
const store = {}
let listener = null
let fetchImpl = null
let setImpl = null

const noopEvent = { addListener() {} }
globalThis.chrome = {
  alarms: { get(_name, cb) { cb(undefined) }, create() {}, onAlarm: noopEvent },
  action: { onClicked: noopEvent },
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
      async set(obj) {
        if (setImpl) return setImpl(obj)
        for (const [k, v] of Object.entries(obj)) store[k] = structuredClone(v)
      },
    },
  },
}
globalThis.fetch = (...args) => fetchImpl(...args)

await import('../src/background/index.ts')
assert.equal(typeof listener, 'function', 'o roteador não registrou chrome.runtime.onMessage')

function send(message) {
  return new Promise(resolve => { listener(message, {}, resolve) })
}

const CODE = { authorizationCode: 'ac-de-uso-unico', codeVerifier: 'verifier' }
const MSG = { type: 'AI_OAUTH_COMPLETE', payload: { label: 'ChatGPT', code: CODE } }

// 1. troca do código falha (HTTP 400 da OpenAI) → erro nomeado, nada gravado
fetchImpl = async () => ({ ok: false, status: 400, async json() { return {} } })
const falha = await send(MSG)
assert.equal(falha.ok, false, 'falha na troca respondeu ok=true')
assert.equal(
  typeof falha.error, 'string',
  'falha na troca respondeu sem código de erro — a UI limpa o painel e não mostra nada'
)
assert.equal(falha.error, 'oauth-exchange-failed')
assert.equal(store[AI_KEY], undefined, 'gravou provedor apesar de a troca ter falhado')

// 2. erro fora da troca (storage indisponível) → fallback do roteador ainda traz código
fetchImpl = async () => ({
  ok: true, status: 200,
  async json() { return { access_token: 'AT-TESTE', refresh_token: 'RT-TESTE' } },
})
setImpl = async () => { throw new Error('storage indisponível') }
const interna = await send(MSG)
assert.equal(interna.ok, false)
assert.equal(
  interna.error, 'internal-error',
  'fallback do roteador para AI_OAUTH_COMPLETE não devolve código de erro traduzível'
)
// getAIConfig nunca devolve estado compartilhado entre chamadas: se a gravação falha,
// nada é observável depois — store vazio implica AI_LIST_PROVIDERS vazio.
assert.equal(store[AI_KEY], undefined, 'gravou provedor apesar de o save ter falhado')
assert.deepEqual(
  await send({ type: 'AI_LIST_PROVIDERS' }),
  { providers: [], activeProviderId: null },
  'save falhou mas a UI ainda lista o provedor — getAIConfig devolveu o default compartilhado e o handler o mutou'
)
setImpl = null

// 3. caminho feliz continua gravando o provedor OAuth
const sucesso = await send(MSG)
assert.equal(sucesso.ok, true)
assert.equal(store[AI_KEY].providers.length, 1)
assert.equal(store[AI_KEY].providers[0].kind, 'openai-oauth')
assert.equal(store[AI_KEY].providers[0].tokens.accessToken, 'AT-TESTE')

// 4. o código de erro tem tradução nos dois idiomas (a UI mostra texto, não código)
for (const lang of ['en', 'pt-BR']) {
  const texto = t('ai.errOAuthExchange', lang)
  assert.ok(
    typeof texto === 'string' && texto.length > 0,
    `ai.errOAuthExchange sem tradução em ${lang}`
  )
}

console.log('✓ ai-oauth-complete: 13 asserções passaram')
