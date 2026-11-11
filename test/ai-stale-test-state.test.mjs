import assert from 'node:assert/strict'
import esbuild from 'esbuild'
import { chromium } from 'playwright'

// INVARIANTE: resultado de teste e lista de modelos são derivados do ENDEREÇO (e
// da credencial), não do id do provedor. Depois de uma edição, a tela não afirma
// "Conectado" sobre um endpoint que nunca foi testado, nem oferece modelo vindo de
// outro servidor.
//
// Endereço e chave são editados na janela de chave da EXTENSÃO (src/aikey/), não
// na sidebar. O id sobrevive à edição, então `testing` e `models` (indexados por
// id) sobreviveriam também: ao voltar o foco para a sidebar depois de abrir a
// janela para um provedor, o que foi medido para ele é descartado. O modelo, que
// foi escolhido numa lista do endpoint antigo, é zerado pelo worker quando o
// endereço muda (test/ai-credential-binding.test.mjs); o mock abaixo reproduz isso.
//
// A escrita TARDIA se identifica ANTES de pintar: com um Testar em voo, a limpeza
// acontece e SÓ DEPOIS a resposta antiga chega. A invalidação é por IDENTIDADE
// (geração por id), não por ordem de chegada.
//
// Cinco metades:
//  A. a janela salvou outro endereço: "Conectado", o combo e o MODELO daquela linha somem.
//  B. a limpeza é POR id: a linha do outro provedor, testada antes, fica intacta.
//  C. a janela salvou só uma chave nova (mesmo endereço): o "Conectado" some, o modelo fica.
//  D. escrita tardia: um Testar disparado ANTES não ressuscita "Conectado" nem o combo.
//  E. a recíproca: um Testar disparado DEPOIS pinta normalmente.
//
// Medido no Chromium real, com o componente REAL e o Preact real fazendo o diff.

const ROOT = new URL('..', import.meta.url).pathname
const { t } = await import('../src/shared/i18n.ts')

const OK = t('ai.testOk', 'en')
const MODELS = ['qwen3', 'llama3']
const P1 = {
  id: 'p1', label: 'Meu servidor', kind: 'api-key',
  baseUrl: 'http://100.100.100.100:8000/v1', model: 'qwen3', hasCredential: true,
}
const P2 = { ...P1, id: 'p2', label: 'Outro', baseUrl: 'http://192.168.1.9:11434/v1' }

// O componente é bundlado a partir do fonte REAL: um teste que reimplementasse a
// árvore aprovaria o defeito, porque o defeito está no componente.
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

  // Fake store do background: o save de edição REALMENTE troca o baseUrl, senão
  // o cenário não é o de um endereço nunca testado.
  const mock = ({ p1, p2, models }) => {
    window.__providers = [p1, p2]
    window.__activeId = null
    window.__saves = []
    window.__opened = []
    // A janela de chave salvou algo (o que o worker faz): troca o registro e devolve o foco à sidebar.
    window.__keyWindowSaved = (id, patch) => {
      const i = window.__providers.findIndex(p => p.id === id)
      const addressChanged = patch.baseUrl !== undefined && patch.baseUrl !== window.__providers[i].baseUrl
      window.__providers[i] = { ...window.__providers[i], ...patch, ...(addressChanged ? { model: null } : {}) }
      window.dispatchEvent(new Event('focus'))
    }
    // Latência do AI_TEST_PROVIDER sob controle do teste: `null` = instantâneo (A,
    // B, C), promise = fica em voo até o teste liberar (D). O contador diz quando a
    // resposta JÁ voltou ao componente, então não se espera por tempo de parede.
    window.__testGate = null
    window.__testResolved = 0
    window.chrome = {
      runtime: {
        async sendMessage(msg) {
          if (msg.type === 'AI_LIST_PROVIDERS') {
            return { providers: window.__providers.map(p => ({ ...p })), activeProviderId: window.__activeId }
          }
          if (msg.type === 'AI_TEST_PROVIDER') {
            if (window.__testGate) await window.__testGate
            window.__testResolved += 1
            return { ok: true, latencyMs: 42 }
          }
          if (msg.type === 'AI_LIST_MODELS') return models.slice()
          if (msg.type === 'AI_SAVE_PROVIDER') window.__saves.push(msg.payload)
          if (msg.type === 'AI_OPEN_KEY_PAGE') window.__opened.push(msg.payload.id)
          return { ok: true }
        },
      },
      storage: { local: { async get() { return {} }, async set() {} } },
      permissions: { async request() { return true } },
    }
  }

  await page.setContent('<!doctype html><html><body style="margin:0"><div id="app"></div></body></html>')
  await page.evaluate(mock, { p1: P1, p2: P2, models: MODELS })
  await page.addScriptTag({ content: code })
  await page.evaluate(() => window.__mount(document.getElementById('app')))

  // Localizadores pela estrutura real: o strong com o nome mora no cabecalho
  // (label do radio de provedor ativo), e o cabecalho mora no card daquele
  // provedor — que e onde ficam os botoes de comando.
  const clickInRow = (label, text) => page.evaluate(({ label, text }) => {
    const strong = [...document.querySelectorAll('strong')].find(s => s.textContent === label)
    if (!strong) throw new Error(`linha "${label}" não está na tela`)
    const btn = [...strong.parentElement.parentElement.querySelectorAll('button')].find(b => b.textContent.trim() === text)
    if (!btn) throw new Error(`botão "${text}" não está na linha "${label}"`)
    btn.click()
  }, { label, text })
  const clickButton = text => page.evaluate(text => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
    if (!btn) throw new Error(`botão "${text}" não está na tela`)
    btn.click()
  }, text)
  const rowState = label => page.evaluate(label => {
    const strong = [...document.querySelectorAll('strong')].find(s => s.textContent === label)
    if (!strong) throw new Error(`linha "${label}" não está na tela`)
    const row = strong.parentElement.parentElement
    return {
      text: row.innerText,
      selects: row.querySelectorAll('select').length,
      options: [...row.querySelectorAll('option')].map(o => o.value).filter(Boolean),
    }
  }, label)
  const settle = () => page.waitForTimeout(150)
  const waitTested = label => page.waitForFunction(({ label, ok }) => {
    const strong = [...document.querySelectorAll('strong')].find(s => s.textContent === label)
    if (!strong) return false
    const row = strong.parentElement.parentElement
    return row.innerText.includes(ok) && row.querySelectorAll('select').length === 1
  }, { label, ok: OK })

  await page.waitForFunction(() => document.querySelectorAll('strong').length >= 2)

  // ── setup: o humano testa as duas linhas ───────────────────────────────────
  await clickInRow('Meu servidor', t('ai.test', 'en'))
  await waitTested('Meu servidor')
  await clickInRow('Outro', t('ai.test', 'en'))
  await waitTested('Outro')
  await settle()

  const testado = await rowState('Meu servidor')
  assert.ok(
    testado.text.includes(`${OK} · 42 ms`),
    `o teste de conexão não pintou o resultado na linha — o cenário não foi reproduzido:\n${testado.text}`,
  )
  assert.deepEqual(
    testado.options, MODELS,
    'o combo de modelos não apareceu depois do teste — o cenário não foi reproduzido',
  )

  // ── A. a janela de chave salvou outro endereço ─────────────────────────────
  await clickInRow('Meu servidor', t('ai.edit', 'en'))
  await settle()
  assert.deepEqual(await page.evaluate(() => window.__opened), ['p1'], 'Editar não abriu a janela de chave desse provedor')
  const NOVO = 'http://10.0.0.7:9000/v1'
  await page.evaluate(novo => window.__keyWindowSaved('p1', { baseUrl: novo }), NOVO)
  await page.waitForFunction(() => document.getElementById('app').innerText.includes('10.0.0.7:9000'))
  await settle()

  const depois = await rowState('Meu servidor')
  assert.equal(
    depois.text.includes(OK), false,
    'a linha continua afirmando "Conectado" depois de trocar o endereço: o resultado é de um ' +
    `endpoint que não é mais o dela, e ninguém testou o novo:\n${depois.text}`,
  )
  assert.equal(
    depois.selects, 0,
    `o combo de modelos do servidor ANTIGO ficou na tela depois de apontar para outro endereço: ` +
    `escolher um manda AI_SAVE_PROVIDER com modelo que o novo endpoint pode não ter (${depois.options.join(', ')})`,
  )
  assert.equal(
    depois.text.includes(P1.model), false,
    `a linha exibe "${NOVO} · ${P1.model}" como configuração válida: o endereço é novo e o modelo é ` +
    `do servidor anterior:\n${depois.text}`,
  )
  assert.deepEqual(await page.evaluate(() => window.__saves), [], 'a sidebar gravou algo por conta própria')

  // ── B. a limpeza é por id: a outra linha fica intacta ──────────────────────
  const outro = await rowState('Outro')
  assert.ok(
    outro.text.includes(OK),
    `salvar a edição de um provedor apagou o resultado de teste do OUTRO — a limpeza varreu o ` +
    `mapa inteiro em vez do id editado:\n${outro.text}`,
  )
  assert.deepEqual(
    outro.options, MODELS,
    'salvar a edição de um provedor apagou o combo de modelos do OUTRO',
  )

  // ── C. só a chave mudou (mesmo endereço) ───────────────────────────────────
  await clickInRow('Outro', t('ai.edit', 'en'))
  await settle()
  await page.evaluate(() => window.__keyWindowSaved('p2', { label: 'Outro' }))
  await settle()

  const outroDepois = await rowState('Outro')
  assert.equal(
    outroDepois.text.includes(OK), false,
    'a linha continua afirmando "Conectado" depois de a janela de chave salvar: aquele resultado foi ' +
    `medido com a chave antiga:\n${outroDepois.text}`,
  )
  assert.equal(
    outroDepois.selects, 0,
    'o combo de modelos sobreviveu à troca de credencial: a lista veio de uma sessão autenticada ' +
    'com a chave anterior',
  )
  assert.ok(
    outroDepois.text.includes(P2.model),
    'editar sem trocar o endereço apagou o modelo: o modelo continua com dono',
  )

  // ── D. escrita TARDIA: a resposta do teste chega DEPOIS do save ─────────────
  // O humano clica em Testar, e enquanto a resposta não volta ele já Edita e Salva
  // com outro endereço. A limpeza do save acontece ANTES da resposta: sem
  // invalidação por identidade, a resposta velha pinta "Conectado" e o combo do
  // servidor anterior sobre um endpoint que ninguém testou.
  await page.evaluate(() => {
    window.__testResolved = 0 // zera: A/B/C já gastaram duas respostas
    window.__testGate = new Promise(resolve => { window.__releaseTest = resolve })
  })
  await clickInRow('Meu servidor', t('ai.test', 'en'))
  // Botão desabilitado = run() marcou busy, ou seja o AI_TEST_PROVIDER já saiu.
  await page.waitForFunction(label => {
    const strong = [...document.querySelectorAll('strong')].find(s => s.textContent === label)
    if (!strong) return false
    return [...strong.parentElement.parentElement.querySelectorAll('button')].some(b => b.disabled)
  }, 'Meu servidor')
  assert.equal(
    await page.evaluate(() => window.__testResolved), 0,
    'o AI_TEST_PROVIDER de D já havia respondido antes do save — o cenário da escrita tardia ' +
    'não foi reproduzido (a latência do mock não segurou nada)',
  )

  await clickInRow('Meu servidor', t('ai.edit', 'en'))
  await settle()
  const NOVISSIMO = 'http://172.16.0.5:7000/v1'
  await page.evaluate(novo => window.__keyWindowSaved('p1', { baseUrl: novo }), NOVISSIMO)
  await page.waitForFunction(() => document.getElementById('app').innerText.includes('172.16.0.5:7000'))
  await settle()

  // agora a resposta antiga volta
  await page.evaluate(() => window.__releaseTest())
  await page.waitForFunction(() => window.__testResolved === 1)
  await settle()

  const tardio = await rowState('Meu servidor')
  assert.ok(
    tardio.text.includes('172.16.0.5:7000'),
    `a janela de D não trocou o endereço da linha — o cenário não foi reproduzido:\n${tardio.text}`,
  )
  assert.equal(
    tardio.text.includes(OK), false,
    'a resposta de um Testar disparado ANTES do save chegou depois dele e ressuscitou "Conectado": ' +
    `a limpeza do save só vale se quem responder primeiro for o save, e isso ninguém combinou:\n${tardio.text}`,
  )
  assert.equal(
    tardio.selects, 0,
    'a resposta tardia trouxe de volta o combo do servidor ANTIGO depois do save que trocou o ' +
    `endereço (${tardio.options.join(', ')})`,
  )

  // ── E. a recíproca: teste disparado DEPOIS do save pinta normalmente ────────
  await page.evaluate(() => { window.__testGate = null })
  await clickInRow('Meu servidor', t('ai.test', 'en'))
  await page.waitForFunction(() => window.__testResolved === 2)
  await settle()

  const fresco = await rowState('Meu servidor')
  assert.ok(
    fresco.text.includes(`${OK} · 42 ms`),
    'um Testar disparado DEPOIS do save deixou de pintar o resultado: a invalidação passou a ' +
    `descartar resposta legítima, e a linha nunca mais diz se conectou:\n${fresco.text}`,
  )
  assert.deepEqual(
    fresco.options, MODELS,
    'o combo de modelos não voltou no teste seguinte ao save: a invalidação está descartando a ' +
    'lista do endpoint CORRENTE',
  )
} finally {
  await browser.close()
}

assert.deepEqual(problems, [], `erros de página no Chromium: ${problems.join(' | ')}`)

console.log('✓ ai-stale-test-state: 22 asserções passaram (Chromium real, componente real)')
