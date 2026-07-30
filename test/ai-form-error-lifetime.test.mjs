import assert from 'node:assert/strict'
import esbuild from 'esbuild'
import { chromium } from 'playwright'

// INVARIANTE: o erro do formulário PERTENCE ao formulário e morre com ele —
// nenhuma ação da UI exibe o erro de outra ação, e a linha vermelha nunca aponta
// para um campo que já não está na tela.
//
// Caminho concreto: com o formulário de EDIÇÃO aberto, o botão Remover da mesma
// linha continua clicável. Se o usuário erra o endereço, clica em Salvar e vê
// "esse endereço não é válido", e então desiste e REMOVE o provedor, o reload
// fecha o formulário órfão (formTargetGone) mas deixa `formError` de pé: sobra
// uma linha vermelha reclamando de um campo que saiu da tela, e ela cola no
// resultado da remoção — que deu certo.
//
// A recíproca também é invariante: NÃO se pode zerar o erro em toda recarga. O
// erro da ação que acabou de acontecer tem de sobreviver a um reload que não
// desfaz o formulário (ex.: marcar outro provedor como ativo).
//
// Medido no Chromium real, com o componente REAL e o Preact real fazendo o diff:
// leitura de código não distingue "fecha o formulário" de "fecha o formulário e
// apaga o erro dele".

const ROOT = new URL('..', import.meta.url).pathname
const { t } = await import('../src/shared/i18n.ts')

const INVALID_URL = t('ai.errInvalidUrl', 'en')
const P1 = {
  id: 'p1', label: 'Meu servidor', kind: 'api-key',
  baseUrl: 'http://100.100.100.100:8000/v1', model: 'qwen3', hasCredential: true,
}
const P2 = { ...P1, id: 'p2', label: 'Outro' }

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

  // Fake store do background: o Remover REALMENTE tira o provedor da lista, senão
  // o formulário nunca fica órfão e o teste passaria por acidente.
  const mock = ({ p1, p2 }) => {
    window.__providers = [p1, p2]
    window.__activeId = null
    window.chrome = {
      runtime: {
        async sendMessage(msg) {
          if (msg.type === 'AI_LIST_PROVIDERS') {
            return { providers: window.__providers.map(p => ({ ...p })), activeProviderId: window.__activeId }
          }
          if (msg.type === 'AI_DELETE_PROVIDER') {
            window.__providers = window.__providers.filter(p => p.id !== msg.payload.id)
            if (window.__activeId === msg.payload.id) window.__activeId = null
            return { ok: true }
          }
          if (msg.type === 'AI_SET_ACTIVE_PROVIDER') {
            window.__activeId = msg.payload.id
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
  await page.evaluate(mock, { p1: P1, p2: P2 })
  await page.addScriptTag({ content: code })
  await page.evaluate(() => window.__mount(document.getElementById('app')))

  // Localizadores pela estrutura real: strong com o nome do provedor mora no
  // rowHead, ao lado dos botões daquela linha.
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
  const screen = () => page.evaluate(() => ({
    text: document.getElementById('app').innerText,
    inputs: document.querySelectorAll('input:not([type=radio])').length,
    labels: [...document.querySelectorAll('strong')].map(s => s.textContent),
  }))
  const settle = () => page.waitForTimeout(150)

  await page.waitForFunction(() => document.querySelectorAll('strong').length >= 2)

  // ── A. o erro morre com o formulário que o gerou ────────────────────────────
  await clickInRow('Meu servidor', t('ai.edit', 'en'))
  await settle()
  // o humano apaga o endereço e tenta salvar
  await page.fill('input:not([type=radio]) >> nth=1', '')
  await clickButton(t('ai.save', 'en'))
  await settle()

  const comErro = await screen()
  assert.ok(
    comErro.text.includes(INVALID_URL),
    `o save com endereço vazio não mostrou erro nenhum — o teste não chegou a reproduzir nada:\n${comErro.text}`,
  )

  // desiste e remove o provedor que estava editando (o botão continua clicável)
  await clickInRow('Meu servidor', t('ai.remove', 'en'))
  await page.waitForFunction(
    () => ![...document.querySelectorAll('strong')].some(s => s.textContent === 'Meu servidor'),
  )
  await settle()

  const depoisDoRemove = await screen()
  assert.equal(
    depoisDoRemove.inputs, 0,
    'o formulário órfão não fechou — o pré-requisito do fix regrediu',
  )
  assert.equal(
    depoisDoRemove.text.includes(INVALID_URL), false,
    'o formulário fechou mas o erro dele ficou na tela: a linha vermelha reclama de um campo ' +
    `que já não existe, e cola no resultado da remoção (que deu certo):\n${depoisDoRemove.text}`,
  )

  // ── B. o erro da ação corrente NÃO é varrido por qualquer recarga ───────────
  await clickInRow('Outro', t('ai.edit', 'en'))
  await settle()
  await page.fill('input:not([type=radio]) >> nth=1', '')
  await clickButton(t('ai.save', 'en'))
  await settle()

  const erroDeNovo = await screen()
  assert.ok(
    erroDeNovo.text.includes(INVALID_URL),
    `o segundo save inválido não produziu erro:\n${erroDeNovo.text}`,
  )

  // reload que NÃO desfaz o formulário: o alvo continua na lista. Marcar o
  // provedor ativo é um rádio no cabeçalho do card, não mais um botão de comando.
  await page.evaluate(() => {
    const strong = [...document.querySelectorAll('strong')].find(s => s.textContent === 'Outro')
    strong.parentElement.querySelector('input[type=radio]').click()
  })
  await page.waitForFunction(
    ativo => {
      const strong = [...document.querySelectorAll('strong')].find(s => s.textContent === 'Outro')
      return !!strong && strong.parentElement.textContent.includes(ativo)
    },
    t('ai.active', 'en'),
  )
  await settle()

  const depoisDoActive = await screen()
  assert.equal(
    depoisDoActive.inputs > 0, true,
    'o formulário de edição fechou numa recarga que não tirou o alvo da lista',
  )
  assert.ok(
    depoisDoActive.text.includes(INVALID_URL),
    'a recarga apagou o erro do formulário que continua aberto: o usuário perde o motivo ' +
    `pelo qual o save dele falhou:\n${depoisDoActive.text}`,
  )
} finally {
  await browser.close()
}

assert.deepEqual(problems, [], `erros de página no Chromium: ${problems.join(' | ')}`)

console.log('✓ ai-form-error-lifetime: 6 asserções passaram (Chromium real, componente real)')
