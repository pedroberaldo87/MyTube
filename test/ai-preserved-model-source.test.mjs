import assert from 'node:assert/strict'
import esbuild from 'esbuild'
import { chromium } from 'playwright'

// INVARIANTE: o modelo preservado é o GRAVADO, nunca o do snapshot do formulário.
// Com o combo da linha e o formulário de edição na tela ao mesmo tempo, salvar o
// formulário sem trocar o endereço preserva o modelo que está em config.providers
// NAQUELE instante — a escolha que o usuário acabou de fazer no combo nunca é
// revertida em silêncio por um AI_SAVE_PROVIDER que só queria trocar o rótulo.
//
// Caminho concreto: `form.model` é um SNAPSHOT tirado no clique em Editar
// (`setForm({ ..., model: p.model })`). O formulário não fecha quando o combo da
// linha grava outro modelo (o reload só fecha formulário órfão, e o provedor
// continua na lista), então os dois convivem na tela. Escolher no combo manda um
// AI_SAVE_PROVIDER com o modelo novo e a lista recarrega; o snapshot, não. Salvar
// o formulário em seguida — mesmo mexendo apenas no rótulo — reescreve o modelo
// ANTIGO por cima do que o usuário acabou de escolher, sem dizer nada.
//
// Preservar o modelo ao editar sem trocar o endereço continua valendo (é o que
// evita desconfigurar o provedor a cada troca de rótulo); o que muda é a FONTE do
// valor preservado: o config corrente, não o texto que o formulário guardou.
//
// Jornada: Testar → Editar → escolher outro modelo NO COMBO DA LINHA → renomear o
// rótulo → Salvar. Lido no payload real (window.__saves.at(-1).model) e na linha.
//
// Medido no Chromium real, com o componente REAL e o Preact real fazendo o diff:
// o defeito é a distância entre dois estados do componente, e só aparece com o
// ciclo de render de verdade no meio.

const ROOT = new URL('..', import.meta.url).pathname
const { t } = await import('../src/shared/i18n.ts')

const OK = t('ai.testOk', 'en')
const MODELS = ['qwen3', 'llama3']
const ANTIGO = 'qwen3'
const ESCOLHIDO = 'llama3'
const RENOMEADO = 'Servidor renomeado'
const P1 = {
  id: 'p1', label: 'Meu servidor', kind: 'api-key',
  baseUrl: 'http://100.100.100.100:8000/v1', model: ANTIGO, hasCredential: true,
}

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

  // Fake store do background: o save REALMENTE grava, senão o config corrente
  // nunca divergiria do snapshot e o cenário não existiria.
  const mock = ({ p1, models }) => {
    window.__providers = [p1]
    window.__activeId = null
    window.__saves = []
    window.chrome = {
      runtime: {
        async sendMessage(msg) {
          if (msg.type === 'AI_LIST_PROVIDERS') {
            return { providers: window.__providers.map(p => ({ ...p })), activeProviderId: window.__activeId }
          }
          if (msg.type === 'AI_TEST_PROVIDER') return { ok: true, latencyMs: 42 }
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
  await page.evaluate(mock, { p1: P1, models: MODELS })
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
      selected: row.querySelector('select')?.value ?? null,
    }
  }, label)
  const settle = () => page.waitForTimeout(150)

  // Pela LINHA, não por contagem de <strong>: o painel "Adicionar" também tem um,
  // então contar deixaria o teste correr antes de a linha do provedor existir.
  await page.waitForFunction(
    label => [...document.querySelectorAll('strong')].some(s => s.textContent === label),
    'Meu servidor',
  )

  // ── setup: o humano testa a conexão e recebe o combo de modelos ─────────────
  await clickInRow('Meu servidor', t('ai.test', 'en'))
  await page.waitForFunction(({ label, ok }) => {
    const strong = [...document.querySelectorAll('strong')].find(s => s.textContent === label)
    if (!strong) return false
    const row = strong.parentElement.parentElement
    return row.innerText.includes(ok) && row.querySelectorAll('select').length === 1
  }, { label: 'Meu servidor', ok: OK })
  await settle()

  // ── Editar: o formulário abre com o snapshot do modelo ANTIGO ───────────────
  await clickInRow('Meu servidor', t('ai.edit', 'en'))
  await page.waitForFunction(() => document.querySelectorAll('input:not([type=radio])').length === 3)
  await settle()

  const aberto = await rowState('Meu servidor')
  assert.equal(
    aberto.selects, 1,
    'o combo da linha saiu da tela quando o formulário abriu — o cenário (combo e formulário ' +
    'simultâneos) não foi reproduzido',
  )
  assert.equal(
    aberto.selected, ANTIGO,
    `o combo não estava em "${ANTIGO}" antes da escolha — o cenário não foi reproduzido`,
  )

  // ── o humano escolhe outro modelo NO COMBO DA LINHA, formulário ainda aberto ─
  await page.selectOption('select', ESCOLHIDO)
  await page.waitForFunction(m => window.__saves.some(s => s.model === m), ESCOLHIDO)
  await settle()

  assert.equal(
    await page.evaluate(() => window.__providers[0].model), ESCOLHIDO,
    `o combo não gravou "${ESCOLHIDO}" — o cenário não foi reproduzido`,
  )
  assert.equal(
    await page.evaluate(() => document.querySelectorAll('input:not([type=radio])').length), 3,
    'o formulário fechou quando o combo gravou o modelo — o cenário (salvar o formulário DEPOIS ' +
    'da escolha) não foi reproduzido',
  )

  // ── renomear o rótulo e Salvar: nada aqui fala de modelo ────────────────────
  await page.fill('input:not([type=radio]) >> nth=0', RENOMEADO)
  await clickButton(t('ai.save', 'en'))
  await page.waitForFunction(() => document.querySelectorAll('input:not([type=radio])').length === 0)
  await settle()

  const salvo = await page.evaluate(() => window.__saves.at(-1))
  assert.equal(
    salvo.label, RENOMEADO,
    'o save não levou o rótulo novo — o cenário (salvar só o rótulo) não foi reproduzido',
  )
  assert.equal(
    salvo.baseUrl, P1.baseUrl,
    'o save mexeu no endereço — o cenário (editar sem trocar de endereço) não foi reproduzido',
  )
  assert.equal(
    salvo.model, ESCOLHIDO,
    `o AI_SAVE_PROVIDER regravou "${salvo.model}" por cima de "${ESCOLHIDO}": o modelo preservado veio ` +
    'do SNAPSHOT do formulário (tirado no clique em Editar), não do que está gravado — a escolha que o ' +
    'usuário acabou de fazer no combo foi revertida em silêncio por um save que só queria trocar o rótulo',
  )

  const depois = await rowState(RENOMEADO)
  assert.ok(
    depois.text.includes(ESCOLHIDO),
    `a linha deixou de exibir o modelo escolhido "${ESCOLHIDO}" depois de renomear o provedor:\n${depois.text}`,
  )
  assert.equal(
    depois.text.includes(ANTIGO), false,
    `a linha voltou a exibir o modelo ANTIGO "${ANTIGO}" depois de um save que só trocou o rótulo:\n${depois.text}`,
  )
} finally {
  await browser.close()
}

assert.deepEqual(problems, [], `erros de página no Chromium: ${problems.join(' | ')}`)

console.log('✓ ai-preserved-model-source: 8 asserções passaram (Chromium real, componente real)')
