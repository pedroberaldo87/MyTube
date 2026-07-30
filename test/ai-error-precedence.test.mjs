import assert from 'node:assert/strict'
import esbuild from 'esbuild'
import { chromium } from 'playwright'

// INVARIANTE: nenhuma ação da UI exibe NEM ENGOLE o erro de outra. Com um device
// flow que morreu e um erro de formulário na tela, os DOIS motivos ficam
// visíveis, cada um ao lado do seu dono — e o painel do código nunca desaparece
// sem dizer por quê.
//
// Continua valendo que `clearDeviceFlowError` zera SÓ `error`, e só fora de
// 'waiting'/'finishing', sem tocar em `generation`: limpar o erro não pode matar
// o laço que vive fora da árvore Preact.
//
// Duas metades:
//  A. o módulo do fluxo (Node): limpar o erro já consumido é inofensivo para um
//     laço vivo.
//  B. o componente REAL no Chromium: uma linha única de erro fazia o motivo da
//     ação corrente esconder o do device flow. O caminho é humano — o usuário
//     espera a aprovação do código e, enquanto espera, tenta cadastrar um
//     endpoint; o save falha; então o polling morre com HTTP 500 e o painel do
//     código evapora da tela sem uma palavra. Leitura de código não vê isso:
//     as duas metades estão em ramos diferentes do JSX.

const ROOT = new URL('..', import.meta.url).pathname

// ─────────────────────────────────────────────────────────────────────────────
// A. o módulo: limpar erro consumido não mata laço vivo
// ─────────────────────────────────────────────────────────────────────────────

let beginResult = null
const START = {
  userCode: 'WXYZ-9999',
  deviceAuthId: 'dev-1',
  interval: 0.01,
  verificationUrl: 'https://auth.openai.com/codex/device',
}

globalThis.chrome = {
  runtime: {
    async sendMessage(msg) {
      if (msg.type === 'AI_OAUTH_BEGIN') return beginResult ?? { ...START }
      if (msg.type === 'AI_OAUTH_COMPLETE') return { ok: true }
      if (msg.type === 'AI_LIST_PROVIDERS') return { providers: [], activeProviderId: null }
      return { ok: true }
    },
  },
}

let polls = 0
globalThis.fetch = async () => {
  polls++
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

// ── A1. um fluxo que falhou deixa erro no módulo ─────────────────────────────
beginResult = { error: 'internal-error' }
await flow.startDeviceFlow()
assert.equal(flow.getDeviceFlowState().status, 'error')
assert.equal(flow.getDeviceFlowState().error, 'internal-error', 'o fluxo falhou sem deixar motivo')

// ── A2. existe caminho para a UI limpar o erro consumido ─────────────────────
assert.equal(
  typeof flow.clearDeviceFlowError, 'function',
  'nenhum caminho limpa flow.error: o erro do device flow sobrevive para sempre a um fluxo já encerrado'
)

flow.clearDeviceFlowError()
assert.equal(flow.getDeviceFlowState().error, null, 'o erro consumido do device flow não foi limpo')
assert.equal(
  flow.getDeviceFlowState().status, 'error',
  'limpar o erro mexeu no status do fluxo — só o campo error é da UI'
)

// ── A3. limpar o erro NÃO mata um laço vivo ──────────────────────────────────
// O laço vive fora da árvore Preact; se `clearDeviceFlowError` tocasse em
// `generation`, uma ação qualquer da UI mataria em silêncio um fluxo em
// andamento e o código já aprovado ficaria órfão.
beginResult = null
const vivo = flow.startDeviceFlow()
await waitFor(() => flow.getDeviceFlowState().start !== null, 'o fluxo vivo não expôs user_code')
const idVivo = flow.getDeviceFlowState().start.deviceAuthId
const pollsAntes = polls
flow.clearDeviceFlowError()
assert.equal(flow.getDeviceFlowState().status, 'waiting', 'limpar o erro cancelou o fluxo em andamento')
assert.equal(
  flow.getDeviceFlowState().start && flow.getDeviceFlowState().start.deviceAuthId, idVivo,
  'limpar o erro apagou o painel do fluxo em andamento'
)
await waitFor(
  () => polls > pollsAntes,
  'o polling parou depois de limpar o erro — a UI matou um laço vivo'
)
flow.cancelDeviceFlow()
await vivo

// ─────────────────────────────────────────────────────────────────────────────
// B. o componente real: um erro não engole o outro
// ─────────────────────────────────────────────────────────────────────────────

const { t } = await import('../src/shared/i18n.ts')
const INVALID_URL = t('ai.errInvalidUrl', 'en')
const USER_CODE = 'WXYZ-9999'

// O componente é bundlado a partir do fonte REAL: um teste que reimplementasse a
// árvore aprovaria o defeito, porque o defeito está na árvore.
const bundle = await esbuild.build({
  absWorkingDir: ROOT,
  stdin: {
    contents: `
      import { h, render } from 'preact'
      import { AISection } from './src/content/sidebar/components/AISection.tsx'
      window.__mount = el => render(h(AISection, {}), el)
    `,
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  logLevel: 'silent',
})
const code = bundle.outputFiles[0].text

const browser = await chromium.launch()
const problems = []
try {
  const page = await browser.newPage()
  page.on('pageerror', e => problems.push(`PAGE ERROR: ${e.message}`))

  // Fake do background + do endpoint de polling. O status do poll é uma variável
  // da página: 403 mantém o fluxo esperando aprovação, 500 o mata de verdade
  // (pollDeviceAuthOnce lança, startDeviceFlow cai no catch e apaga o painel).
  const mock = ({ start }) => {
    window.__pollStatus = 403
    window.chrome = {
      runtime: {
        async sendMessage(msg) {
          if (msg.type === 'AI_LIST_PROVIDERS') return { providers: [], activeProviderId: null }
          if (msg.type === 'AI_OAUTH_BEGIN') return { ...start }
          return { ok: true }
        },
      },
      storage: { local: { async get() { return {} }, async set() {} } },
      permissions: { async request() { return true } },
    }
    // Nenhuma chamada de rede real sai daqui.
    window.fetch = async () => ({
      ok: window.__pollStatus === 200,
      status: window.__pollStatus,
      async json() { return {} },
    })
  }

  await page.setContent('<!doctype html><html><body style="margin:0"><div id="app"></div></body></html>')
  await page.evaluate(mock, { start: { ...START, interval: 0.02 } })
  await page.addScriptTag({ content: code })
  await page.evaluate(() => window.__mount(document.getElementById('app')))

  const clickButton = text => page.evaluate(text => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
    if (!btn) throw new Error(`botão "${text}" não está na tela`)
    btn.click()
  }, text)
  const screen = () => page.evaluate(() => document.getElementById('app').innerText)
  const settle = () => page.waitForTimeout(150)

  await page.waitForFunction(
    label => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === label),
    t('ai.connectChatGPT', 'en'),
  )

  // ── B1. o humano começa o device flow e vê o código ─────────────────────────
  await clickButton(t('ai.connectChatGPT', 'en'))
  await page.waitForFunction(
    c => document.getElementById('app').innerText.includes(c),
    USER_CODE,
  )

  // ── B2. enquanto espera aprovação, tenta cadastrar um endpoint e erra ───────
  await clickButton(t('ai.addEndpoint', 'en'))
  await settle()
  await clickButton(t('ai.save', 'en'))
  await settle()

  const esperando = await screen()
  assert.ok(
    esperando.includes(INVALID_URL),
    `o save com endereço vazio não mostrou erro nenhum — o teste não chegou a reproduzir nada:\n${esperando}`,
  )
  assert.ok(
    esperando.includes(USER_CODE),
    `o painel do código sumiu antes do fluxo morrer — o cenário não é o que se quer medir:\n${esperando}`,
  )

  // ── B3. o polling morre (HTTP 500): o painel do código evapora ─────────────
  await page.evaluate(() => { window.__pollStatus = 500 })
  await page.waitForFunction(
    c => !document.getElementById('app').innerText.includes(c),
    USER_CODE,
  )
  await settle()

  const depois = await screen()
  assert.equal(
    depois.includes(USER_CODE), false,
    'o painel do código continuou na tela depois de o fluxo morrer',
  )
  assert.ok(
    depois.includes('HTTP 500'),
    'o painel do código desapareceu SEM dizer por quê: o erro da ação do formulário engoliu o ' +
    `motivo do device flow, e o usuário fica olhando o lugar onde estava o código:\n${depois}`,
  )
  assert.ok(
    depois.includes(INVALID_URL),
    'o motivo do device flow engoliu o erro do formulário: o campo continua inválido na tela e ' +
    `ninguém mais diz isso:\n${depois}`,
  )
} finally {
  await browser.close()
}

assert.deepEqual(problems, [], `erros de página no Chromium: ${problems.join(' | ')}`)

console.log('✓ ai-error-precedence: 13 asserções passaram (módulo em Node + componente real no Chromium)')
