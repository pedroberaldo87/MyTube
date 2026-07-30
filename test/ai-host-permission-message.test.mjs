import assert from 'node:assert/strict'
import { t } from '../src/shared/i18n.ts'

// INVARIANTE: o aceite de permissão de host funciona A PARTIR DA SIDEBAR.
//
// A interface do app é a sidebar, que roda no mundo isolado do content script —
// lá `chrome` expõe dom, extension, i18n, runtime e storage, e
// `chrome.permissions` é undefined (verificado por CDP). Então ensureHostPermission
// despacha AI_REQUEST_HOST_PERMISSION e ESPERA o desfecho real; o background abre
// uma janelinha popup de propósito único e responde quando o usuário decide.
//
// O que este teste tranca:
//  1. sem chrome.permissions, ensureHostPermission despacha a mensagem com o
//     endereço NORMALIZADO e devolve o desfecho que voltar por ela;
//  2. endereço inválido devolve 'invalid-url' sem despachar nada (nenhuma
//     janelinha se abre por lixo digitado);
//  3. o handler REAL do background abre chrome.windows.create type:'popup'
//     460x340 apontando para permission/index.html com a ORIGEM e a aba na URL;
//  4. fechar a janelinha sem decidir resolve como 'denied' — sem isso a sidebar
//     esperaria para sempre.

const store = {}
let onMessage = null
let onWindowRemoved = null
/** Opções de cada chrome.windows.create — é o que prova a forma da janelinha. */
const created = []
/** Mensagens que a SIDEBAR despachou (o que sai de ensureHostPermission). */
const dispatched = []
let sendMessageImpl = null
let createImpl = null

const noopEvent = { addListener() {} }
globalThis.chrome = {
  alarms: { get(_n, cb) { cb(undefined) }, create() {}, onAlarm: noopEvent },
  action: { onClicked: noopEvent },
  tabs: { async sendMessage() {} },
  windows: {
    onRemoved: { addListener(fn) { onWindowRemoved = fn } },
    async create(opts) {
      created.push(opts)
      if (createImpl) return createImpl(opts)
      return { id: 4242 }
    },
  },
  runtime: {
    onInstalled: noopEvent,
    onStartup: noopEvent,
    onMessage: { addListener(fn) { onMessage = fn } },
    getURL: path => `chrome-extension://mytube/${path}`,
    async sendMessage(message) {
      dispatched.push(message)
      return sendMessageImpl(message)
    },
    async openOptionsPage() {},
  },
  storage: {
    local: {
      // chrome.storage serializa: o handler nunca recebe a referência do store.
      async get(key) { return key in store ? { [key]: structuredClone(store[key]) } : {} },
      async set(obj) { for (const [k, v] of Object.entries(obj)) store[k] = structuredClone(v) },
    },
  },
  // `permissions` AUSENTE de propósito: é exatamente o mundo da sidebar.
}

assert.equal(
  globalThis.chrome.permissions, undefined,
  'o mock precisa reproduzir o mundo da sidebar, onde chrome.permissions não existe',
)

const { ensureHostPermission, normalizeEndpointUrl, originFromUrl } =
  await import('../src/shared/ai/host-permission.ts')
await import('../src/background/index.ts')
assert.equal(typeof onMessage, 'function', 'o roteador do background não registrou onMessage')
assert.equal(
  typeof onWindowRemoved, 'function',
  'o background não escuta chrome.windows.onRemoved — fechar a janelinha deixaria a sidebar pendurada',
)

/** Espera uma condição pelas microtarefas, sem timer fixo. */
async function esperar(cond, oQue) {
  for (let i = 0; i < 200; i++) {
    if (cond()) return
    await new Promise(r => setTimeout(r, 0))
  }
  assert.fail(`esperei e não veio: ${oQue}`)
}

// ── 1. a sidebar despacha, com o endereço normalizado, e devolve o desfecho ───

const CRU = 'localhost:11434/v1'
const NORMALIZADO = normalizeEndpointUrl(CRU)
assert.equal(NORMALIZADO, 'http://localhost:11434/v1', 'o normalizador mudou — o teste ficou cego')
assert.equal(originFromUrl(NORMALIZADO), 'http://localhost:11434/*')

sendMessageImpl = async () => ({ outcome: 'granted' })
assert.equal(await ensureHostPermission(CRU), 'granted')
assert.equal(dispatched.length, 1, 'ensureHostPermission não despachou nada sem chrome.permissions')
assert.equal(dispatched[0].type, 'AI_REQUEST_HOST_PERMISSION')
assert.equal(
  dispatched[0].payload.url, NORMALIZADO,
  'a mensagem levou o texto cru — o background tem de receber o endereço já normalizado',
)

// o desfecho é o que VOLTA na mensagem, não um "recebi"
sendMessageImpl = async () => ({ outcome: 'denied' })
assert.equal(await ensureHostPermission(CRU), 'denied')
sendMessageImpl = async () => ({ outcome: 'cannot-request' })
assert.equal(await ensureHostPermission(CRU), 'cannot-request')

// canal morto (worker reiniciado no meio) não é o usuário recusando
sendMessageImpl = async () => { throw new Error('Receiving end does not exist') }
assert.equal(
  await ensureHostPermission(CRU), 'cannot-request',
  'canal morto virou "denied" — a tela acusaria o usuário de ter recusado',
)
// resposta sem desfecho (worker respondeu vazio) também não é recusa
sendMessageImpl = async () => undefined
assert.equal(await ensureHostPermission(CRU), 'cannot-request')

// ── 2. lixo digitado devolve invalid-url SEM despachar ────────────────────────

const antes = dispatched.length
sendMessageImpl = async () => assert.fail('despachou mensagem para um endereço inválido')
for (const lixo of ['nao é uma url', '', '   ', 'ftp://x.com/v1', 'http://', '...']) {
  assert.equal(
    await ensureHostPermission(lixo), 'invalid-url',
    `"${lixo}" não devolveu invalid-url`,
  )
}
assert.equal(dispatched.length, antes, 'endereço inválido abriu janelinha')

// ── 3. o handler REAL do background abre a janelinha certa ────────────────────

/** Daqui em diante o sendMessage da sidebar cai no roteador de verdade. */
sendMessageImpl = message =>
  new Promise(resolve => { onMessage(message, { tab: { id: 77 } }, resolve) })

const pendente = ensureHostPermission('http://100.100.100.100:8000/v1')
await esperar(() => created.length === 1, 'chrome.windows.create da janelinha de permissão')

const opts = created[0]
assert.equal(opts.type, 'popup', 'a permissão abriu aba/janela normal em vez de popup')
assert.equal(opts.width, 460)
assert.equal(opts.height, 340)
assert.equal(opts.focused, true, 'a janelinha abriu sem foco — o usuário não veria o pedido')

const url = new URL(opts.url)
assert.ok(
  url.pathname.endsWith('/permission/index.html'),
  `a janelinha aponta para ${url.pathname}, não para a página de propósito único`,
)
assert.equal(
  url.searchParams.get('origin'), 'http://100.100.100.100:8000/*',
  'a URL da janelinha não leva a origem normalizada como match pattern',
)
const requestId = url.searchParams.get('request')
assert.match(
  requestId, /^77-\d+$/,
  'o requestId não carrega a aba que pediu — duas abas pedindo juntas se confundiriam',
)

// a janelinha responde: o await da sidebar recebe o desfecho REAL
const recibo = await new Promise(resolve => {
  onMessage({ type: 'AI_HOST_PERMISSION_RESULT', payload: { requestId, outcome: 'granted' } }, {}, resolve)
})
assert.deepEqual(recibo, { ok: true })
assert.equal(await pendente, 'granted', 'o desfecho da janelinha não chegou a quem pediu')

// ── 4. fechar a janelinha sem decidir é recusa ────────────────────────────────

const pendente2 = ensureHostPermission('localhost:11434')
await esperar(() => created.length === 2, 'segunda janelinha de permissão')
// o windowId é gravado depois que o create resolve
await esperar(() => true, 'ciclo')
onWindowRemoved(4242)
assert.equal(
  await pendente2, 'denied',
  'fechar a janelinha sem decidir deixou a sidebar esperando para sempre',
)
// fechar uma janela qualquer depois não estoura nada
onWindowRemoved(4242)

// ── 5. o próprio background recusa endereço inválido, sem abrir janela ────────

const antesJanelas = created.length
const invalido = await new Promise(resolve => {
  onMessage({ type: 'AI_REQUEST_HOST_PERMISSION', payload: { url: 'nao é uma url' } }, { tab: { id: 9 } }, resolve)
})
assert.deepEqual(invalido, { outcome: 'invalid-url' })
assert.equal(created.length, antesJanelas, 'o background abriu janelinha para endereço inválido')

// ── 6. create falhando não é recusa do usuário ────────────────────────────────

createImpl = () => Promise.reject(new Error('sem janelas disponíveis'))
const semJanela = await new Promise(resolve => {
  onMessage({ type: 'AI_REQUEST_HOST_PERMISSION', payload: { url: 'localhost:11434' } }, { tab: { id: 9 } }, resolve)
})
assert.deepEqual(
  semJanela, { outcome: 'cannot-request' },
  'falha ao abrir a janelinha virou "denied" — acusaria o usuário de recusar',
)
createImpl = null

// ── 7. o diálogo tem texto nas duas línguas (a janelinha mostra texto, não chave)

for (const lang of ['en', 'pt-BR']) {
  for (const key of ['perm.title', 'perm.line', 'perm.allow']) {
    const texto = t(key, lang)
    assert.ok(
      typeof texto === 'string' && texto.length > 0 && texto !== key,
      `${key} sem tradução em ${lang}`,
    )
  }
}
assert.notEqual(t('perm.allow', 'en'), t('perm.allow', 'pt-BR'), 'perm.allow não foi traduzido')

console.log('✓ ai-host-permission-message: 36 asserções passaram')
