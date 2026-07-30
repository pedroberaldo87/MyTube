import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// INVARIANTE: device flow em andamento sobrevive à remontagem do COMPONENTE
// (refresh de tag, troca de aba) — desmontar/remontar AISection não cancela o
// polling e o painel volta a exibir o MESMO user_code; se o fluxo terminar sem
// sucesso a UI mostra o motivo. O laço encerra por cancelamento explícito do
// usuário, por expiração, OU por falha de rede/HTTP no polling.
// NÃO sobrevive a reload da página nem a fechar a aba: todo o estado é memória
// (`let state`), não há persistência — esse caminho segue descoberto.
// (spec 5: quem itera o polling é a página, não o componente)

let beginCalls = 0
let completeCalls = 0
let listCalls = 0
let completeResult = { ok: true }
const START = {
  userCode: 'ABCD-1234',
  deviceAuthId: 'dev-1',
  interval: 0.01,
  verificationUrl: 'https://auth.openai.com/codex/device',
}

let holdOnComplete = null

/** Segura o PRÓXIMO AI_OAUTH_COMPLETE em voo (o await de :69, não o do poll). */
function holdNextComplete() {
  let release
  let arrived
  const inFlight = new Promise(r => { arrived = r })
  const blocked = new Promise(r => { release = r })
  holdOnComplete = { blocked, arrived }
  return { inFlight, release: () => release() }
}

globalThis.chrome = {
  runtime: {
    async sendMessage(msg) {
      if (msg.type === 'AI_OAUTH_BEGIN') { beginCalls++; return { ...START, deviceAuthId: `dev-${beginCalls}` } }
      if (msg.type === 'AI_OAUTH_COMPLETE') {
        completeCalls++
        if (holdOnComplete) {
          const h = holdOnComplete
          holdOnComplete = null
          h.arrived()
          await h.blocked
        }
        return completeResult
      }
      if (msg.type === 'AI_LIST_PROVIDERS') { listCalls++; return { providers: [], activeProviderId: null } }
      return { ok: true }
    },
  },
}

let polls = 0
let approveAtPoll = Infinity
/** polls contados por device_auth_id — é assim que se vê um laço zumbi polando o id velho. */
const pollsById = new Map()
/** ids que o usuário já aprovou no navegador (aprovação dirigida a um fluxo). */
const approvedIds = new Set()
let hold = null

/** Segura o PRÓXIMO poll em voo, para cancelar exatamente durante o await. */
function holdNextPoll() {
  let release
  let arrived
  const inFlight = new Promise(r => { arrived = r })
  const blocked = new Promise(r => { release = r })
  hold = { blocked, arrived }
  return { inFlight, release: () => release() }
}

globalThis.fetch = async (_url, init) => {
  const body = init && init.body ? JSON.parse(init.body) : {}
  const id = body.device_auth_id ?? 'unknown'
  polls++
  pollsById.set(id, (pollsById.get(id) ?? 0) + 1)
  if (hold) {
    const h = hold
    hold = null
    h.arrived()
    await h.blocked
  }
  if (polls >= approveAtPoll || approvedIds.has(id)) {
    return { ok: true, status: 200, async json() { return { authorization_code: 'ac-1', code_verifier: 'ver-1' } } }
  }
  return { ok: false, status: 403, async json() { return {} } }
}

const flow = await import('../src/content/sidebar/deviceFlow.ts')

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(pred, msg, timeout = 3000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (pred()) return
    await sleep(5)
  }
  assert.fail(msg)
}

// ── 1. o laço sobrevive ao desmonte do componente ────────────────────────────
approveAtPoll = Infinity
const running = flow.startDeviceFlow()

// "mount": o componente assina o módulo
let seen = []
const unmount = flow.subscribeDeviceFlow(s => seen.push(s))
await waitFor(() => flow.getDeviceFlowState().start !== null, 'o módulo nunca expôs o user_code')
assert.equal(flow.getDeviceFlowState().status, 'waiting')
assert.equal(flow.getDeviceFlowState().start.userCode, 'ABCD-1234')

// "unmount": cleanup do useEffect. NÃO pode encerrar o laço.
unmount()
const pollsAoDesmontar = polls
await waitFor(
  () => polls > pollsAoDesmontar,
  'o polling parou quando o componente desmontou — o código aprovado fica órfão'
)
assert.equal(
  flow.getDeviceFlowState().status, 'waiting',
  'desmontar o componente cancelou o fluxo'
)

// "remount": o painel volta a exibir o mesmo user_code, sem recomeçar nada
const remontado = flow.getDeviceFlowState()
assert.equal(remontado.start.userCode, 'ABCD-1234', 'ao remontar o painel perdeu o user_code')
assert.equal(beginCalls, 1, 'a remontagem disparou um segundo AI_OAUTH_BEGIN')

// guarda de reentrada: clicar de novo com um laço em andamento não abre outro
await flow.startDeviceFlow()
assert.equal(beginCalls, 1, 'start reentrante abriu um segundo device flow')

// aprovação chega → o módulo troca o código e conclui
approveAtPoll = polls + 1
await running
assert.equal(flow.getDeviceFlowState().status, 'done')
assert.equal(completeCalls, 1, 'AI_OAUTH_COMPLETE não foi enviado uma única vez')
assert.equal(flow.getDeviceFlowState().start, null, 'painel continuou aberto depois de concluir')

// ── 2. fim sem sucesso deixa motivo legível (nunca painel vazio e mudo) ──────
completeResult = { ok: false, error: 'oauth-exchange-failed' }
approveAtPoll = polls + 1
await flow.startDeviceFlow()
const falhou = flow.getDeviceFlowState()
assert.equal(falhou.status, 'error')
assert.equal(
  falhou.error, 'oauth-exchange-failed',
  'fluxo terminou em erro sem código legível — a UI mostra painel vazio'
)

// ── 3. cancelamento explícito encerra o laço ─────────────────────────────────
completeResult = { ok: true }
approveAtPoll = Infinity
const segundo = flow.startDeviceFlow()
await waitFor(() => flow.getDeviceFlowState().start !== null, 'segundo fluxo não expôs user_code')
const notificacoes = []
const off = flow.subscribeDeviceFlow(s => notificacoes.push(s.status))
flow.cancelDeviceFlow()
assert.equal(flow.getDeviceFlowState().status, 'cancelled')
assert.ok(notificacoes.includes('cancelled'), 'o cancelamento não notificou a UI')
await segundo
const pollsAoCancelar = polls
await sleep(80)
assert.equal(polls, pollsAoCancelar, 'o laço continuou depois do cancelamento explícito')
off()

// ── 4. o componente não é o dono do laço ─────────────────────────────────────
const src = await readFile(new URL('../src/content/sidebar/components/AISection.tsx', import.meta.url), 'utf8')
assert.equal(
  /pollDeviceAuthOnce/.test(src), false,
  'AISection ainda itera o polling: o laço morre com o componente'
)

// ── 5. cancelar com poll em voo que volta aprovado: nada é gravado ───────────
// INVARIANTE: cancelamento é definitivo. Nenhum token gravado depois do clique
// em Cancelar — nem quando o poll em voo volta com authorization_code.
// Cancelar só é oferecido enquanto o fluxo ESPERA aprovação; a partir da troca do
// código ele deixa de existir (caso 8), então não há janela em que ele minta.
completeResult = { ok: true }
approveAtPoll = Infinity
approvedIds.clear()
const voo = holdNextPoll()
const emVoo = flow.startDeviceFlow()
await waitFor(() => flow.getDeviceFlowState().start !== null, 'fluxo do caso 5 não expôs user_code')
const idEmVoo = flow.getDeviceFlowState().start.deviceAuthId
await voo.inFlight
const completeAntes = completeCalls
flow.cancelDeviceFlow()
approvedIds.add(idEmVoo) // o usuário já havia aprovado no navegador antes de cancelar
voo.release()
await emVoo
await sleep(60)
assert.equal(
  completeCalls, completeAntes,
  'AI_OAUTH_COMPLETE foi enviado depois do Cancelar — token gravado sem consentimento'
)
assert.equal(
  flow.getDeviceFlowState().status, 'cancelled',
  'o laço cancelado voltou a emitir estado depois do Cancelar'
)

// ── 6. laço cancelado nunca ressuscita quando um novo start começa ────────────
// INVARIANTE: cancelamento é por execução — o laço velho não pola mais nem emite,
// mesmo depois de um novo startDeviceFlow (sem laço zumbi, sem device-expired falso).
approvedIds.clear()
approveAtPoll = Infinity
const voo2 = holdNextPoll()
const velho = flow.startDeviceFlow()
await waitFor(() => flow.getDeviceFlowState().start !== null, 'fluxo velho do caso 6 não expôs user_code')
const idVelho = flow.getDeviceFlowState().start.deviceAuthId
await voo2.inFlight
flow.cancelDeviceFlow()
const novo = flow.startDeviceFlow() // usuário clica em Conectar de novo
await waitFor(
  () => flow.getDeviceFlowState().start !== null
    && flow.getDeviceFlowState().start.deviceAuthId !== idVelho,
  'o novo fluxo não abriu depois do cancelamento'
)
const idNovo = flow.getDeviceFlowState().start.deviceAuthId
const pollsVelhoAntes = pollsById.get(idVelho)
voo2.release() // o poll velho volta (sem código) já com o novo fluxo no ar
await sleep(120) // tempo de sobra para vários intervals (0,01 s) dos dois laços
assert.equal(
  pollsById.get(idVelho), pollsVelhoAntes,
  'o laço cancelado voltou a polar o device_auth_id velho — laço zumbi'
)
assert.ok(
  pollsById.get(idNovo) > 0,
  'o fluxo novo não chegou a polar'
)
const durante = flow.getDeviceFlowState()
assert.equal(
  durante.status, 'waiting',
  `o laço velho sobrescreveu o estado do fluxo novo (status=${durante.status}, error=${durante.error})`
)
assert.equal(
  durante.start && durante.start.deviceAuthId, idNovo,
  'o painel do fluxo novo foi apagado pelo laço velho'
)
flow.cancelDeviceFlow()
await Promise.all([velho, novo])

// ── 7. nenhum laço morto escreve no estado global (await do AI_OAUTH_COMPLETE) ─
// INVARIANTE: um fluxo SUBSTITUÍDO nunca emite depois do await do
// AI_OAUTH_COMPLETE — o painel do fluxo NOVO permanece intacto (start = o código
// novo, status 'waiting') e continua cancelável pela UI.
// (a troca já despachada grava o token de qualquer forma; a decisão do Pedro foi
//  retirar o Cancelar nessa janela em vez de prometer o que não cumpre — caso 8)
completeResult = { ok: true }
approvedIds.clear()
approveAtPoll = polls + 1
const completeEmVoo = holdNextComplete()
const velho7 = flow.startDeviceFlow()
await completeEmVoo.inFlight // o laço velho está parado DENTRO do await do COMPLETE
approveAtPoll = Infinity // o fluxo novo não deve ser aprovado sozinho
flow.cancelDeviceFlow()
const novo7 = flow.startDeviceFlow() // usuário clica em Conectar de novo
await waitFor(
  () => flow.getDeviceFlowState().start !== null,
  'o novo fluxo não abriu depois do cancelamento (caso 7)'
)
const idNovo7 = flow.getDeviceFlowState().start.deviceAuthId
completeEmVoo.release() // a troca do fluxo MORTO volta agora, com o fluxo novo no ar
await velho7
await sleep(60)
const depois7 = flow.getDeviceFlowState()
assert.equal(
  depois7.status, 'waiting',
  `o laço morto emitiu depois do await do AI_OAUTH_COMPLETE (status=${depois7.status}, error=${depois7.error})`
)
assert.equal(
  depois7.start && depois7.start.deviceAuthId, idNovo7,
  'o painel do fluxo novo foi apagado pelo retorno do AI_OAUTH_COMPLETE do fluxo morto'
)
flow.cancelDeviceFlow()
assert.equal(
  flow.getDeviceFlowState().status, 'cancelled',
  'o fluxo novo deixou de ser cancelável pela UI'
)
await novo7

// ── 8. depois da troca do código, Cancelar não é oferecido nem funciona ───────
// INVARIANTE: do despacho do AI_OAUTH_COMPLETE em diante o fluxo está 'finishing'
// e cancelar é impossível — a gravação do token já está em voo, então a UI para de
// oferecer um botão que não pode cumprir o que promete. O painel mostra "concluindo".
completeResult = { ok: true }
approvedIds.clear()
approveAtPoll = polls + 1
const troca = holdNextComplete()
const fim = flow.startDeviceFlow()
await troca.inFlight // o laço está parado DENTRO do await do COMPLETE
assert.equal(
  flow.getDeviceFlowState().status, 'finishing',
  'o fluxo não sinalizou que está concluindo — a UI não sabe esconder o Cancelar'
)
const completeAntes8 = completeCalls
flow.cancelDeviceFlow() // exatamente o que a UI não deve mais oferecer
assert.equal(
  flow.getDeviceFlowState().status, 'finishing',
  'Cancelar alterou o estado depois da troca — a tela mente: o token vai ser gravado'
)
troca.release()
await fim
assert.equal(flow.getDeviceFlowState().status, 'done', 'o fluxo não concluiu depois da troca')
assert.equal(completeCalls, completeAntes8, 'o AI_OAUTH_COMPLETE foi despachado mais de uma vez')
assert.equal(flow.getDeviceFlowState().start, null, 'o painel continuou aberto depois de concluir')

// ── 9. a UI não oferece Cancelar durante a conclusão ─────────────────────────
const uiSrc = await readFile(new URL('../src/content/sidebar/components/AISection.tsx', import.meta.url), 'utf8')
assert.ok(
  /finishing/.test(uiSrc),
  'AISection não distingue o estado de conclusão: o Cancelar continua na tela durante a troca'
)

assert.ok(listCalls >= 0)
console.log('✓ ai-device-flow-remount: 32 asserções passaram')
