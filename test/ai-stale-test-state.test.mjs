import assert from 'node:assert/strict'
import esbuild from 'esbuild'
import { chromium } from 'playwright'

// INVARIANTE: resultado de teste e lista de modelos são derivados do ENDEREÇO (e
// da credencial), não do id do provedor. Depois de salvar uma edição, a tela não
// afirma "Conectado" sobre um endpoint que nunca foi testado, nem oferece modelo
// vindo de outro servidor.
//
// Caminho concreto: `testing` e `models` são mapas indexados por p.id. O humano
// testa o provedor (a linha passa a dizer "Connected · 42 ms" e ganha o combo de
// modelos daquele servidor), depois clica em Editar, troca o Base URL e Salva.
// O id não muda, então as duas entradas sobrevivem: a linha continua afirmando
// conectividade de um endereço que nunca foi alcançado, e o combo continua
// oferecendo modelos do servidor antigo — escolher um manda um AI_SAVE_PROVIDER
// com modelo que o novo endpoint pode não ter.
//
// O MODELO é derivado do endereço pelo mesmo motivo: ele foi escolhido numa lista
// que o endpoint antigo devolveu. Nenhum AI_SAVE_PROVIDER pode gravar um modelo
// medido em outro endpoint, e a linha nunca pode exibir `novoEndereço · modeloAntigo`
// como configuração válida. Mas editar SEM trocar o endereço preserva o modelo:
// mandar null sempre desconfiguraria o provedor a cada troca de rótulo.
//
// A escrita TARDIA se identifica ANTES de pintar: não basta limpar no save, porque
// quem responde primeiro não é combinado. Com um Testar em voo, a limpeza do save
// acontece e SÓ DEPOIS a resposta antiga chega — e volta a escrever "Conectado" e
// o combo do servidor anterior por cima do endereço novo. Invalidar por ordem de
// chegada é frágil; a invalidação é por IDENTIDADE (geração por id).
//
// Cinco metades:
//  A. salvar uma edição que troca o endereço zera "Conectado", o combo e o MODELO
//     daquela linha (na tela e no payload que vai ao background).
//  B. a limpeza é POR id: a linha do outro provedor, testada antes, fica intacta
//     (um fix que zerasse os mapas inteiros passaria em A e falharia aqui).
//  C. sem comparar strings: salvar edição que muda só a CHAVE também zera o
//     "Conectado" — foi medido com a credencial antiga — mas o endereço é o mesmo,
//     então o MODELO continua com dono e é preservado.
//  D. escrita tardia: um Testar disparado ANTES do save (mock com latência sob
//     controle do teste) não ressuscita "Conectado" nem o combo depois que o save
//     trocou o endereço.
//  E. a recíproca: um Testar disparado DEPOIS do save pinta normalmente — um fix
//     que simplesmente parasse de pintar passaria em D e falharia aqui.
//
// Medido no Chromium real, com o componente REAL e o Preact real fazendo o diff:
// leitura de código não mostra o que sobra na tela depois do save.

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
          if (msg.type === 'AI_SAVE_PROVIDER') {
            window.__saves.push(msg.payload)
            const i = window.__providers.findIndex(p => p.id === msg.payload.id)
            if (i !== -1) {
              window.__providers[i] = { ...window.__providers[i], ...msg.payload, hasCredential: true }
            }
            return { ok: true }
          }
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

  // ── A. edição que troca o endereço zera resultado e modelos ────────────────
  await clickInRow('Meu servidor', t('ai.edit', 'en'))
  await settle()
  const NOVO = 'http://10.0.0.7:9000/v1'
  await page.fill('input:not([type=radio]) >> nth=1', NOVO)
  await clickButton(t('ai.save', 'en'))
  await page.waitForFunction(() => document.querySelectorAll('input:not([type=radio])').length === 0)
  await settle()

  const depois = await rowState('Meu servidor')
  assert.ok(
    depois.text.includes('10.0.0.7:9000'),
    `o save não trocou o endereço da linha — o cenário não foi reproduzido:\n${depois.text}`,
  )
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
  const salvoA = await page.evaluate(() => window.__saves.at(-1))
  assert.equal(
    salvoA.baseUrl, NOVO,
    'o payload do save não levou o endereço novo — o cenário A não foi reproduzido',
  )
  assert.equal(
    salvoA.model, null,
    `o AI_SAVE_PROVIDER gravou o modelo "${salvoA.model}" junto do endereço novo: aquele modelo foi ` +
    'escolhido numa lista que o endpoint ANTIGO devolveu, e o novo pode não tê-lo',
  )
  assert.equal(
    depois.text.includes(P1.model), false,
    `a linha exibe "${NOVO} · ${P1.model}" como configuração válida: o endereço é novo e o modelo é ` +
    `do servidor anterior:\n${depois.text}`,
  )

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

  // ── C. sem comparar strings: mudar só a chave também invalida ──────────────
  await clickInRow('Outro', t('ai.edit', 'en'))
  await settle()
  await page.fill('input:not([type=radio]) >> nth=2', 'sk-chave-nova')
  await clickButton(t('ai.save', 'en'))
  await page.waitForFunction(() => document.querySelectorAll('input:not([type=radio])').length === 0)
  await settle()

  const salvos = await page.evaluate(() => window.__saves.at(-1))
  assert.equal(
    salvos.apiKey, 'sk-chave-nova',
    'o save não levou a chave nova — o cenário C não foi reproduzido',
  )
  assert.equal(
    salvos.baseUrl, P2.baseUrl,
    'o save de C mexeu no endereço — o cenário (editar sem trocar de endereço) não foi reproduzido',
  )
  assert.equal(
    salvos.model, P2.model,
    'editar sem trocar o endereço apagou o modelo: o modelo continua com dono, e mandar null aqui ' +
    'desconfigura o provedor a cada troca de rótulo ou de chave',
  )
  const outroDepois = await rowState('Outro')
  assert.equal(
    outroDepois.text.includes(OK), false,
    'a linha continua afirmando "Conectado" depois de trocar a CREDENCIAL: aquele resultado foi ' +
    `medido com a chave antiga:\n${outroDepois.text}`,
  )
  assert.equal(
    outroDepois.selects, 0,
    'o combo de modelos sobreviveu à troca de credencial: a lista veio de uma sessão autenticada ' +
    'com a chave anterior',
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
  await page.fill('input:not([type=radio]) >> nth=1', NOVISSIMO)
  await clickButton(t('ai.save', 'en'))
  await page.waitForFunction(() => document.querySelectorAll('input:not([type=radio])').length === 0)
  await settle()

  // agora a resposta antiga volta
  await page.evaluate(() => window.__releaseTest())
  await page.waitForFunction(() => window.__testResolved === 1)
  await settle()

  const tardio = await rowState('Meu servidor')
  assert.ok(
    tardio.text.includes('172.16.0.5:7000'),
    `o save de D não trocou o endereço da linha — o cenário não foi reproduzido:\n${tardio.text}`,
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
