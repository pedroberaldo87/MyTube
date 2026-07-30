import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// INVARIANTE: rótulo de controle interativo passa AA nos 4 cruzamentos de base —
// inclusive no dashboard. Nenhum controle usa --mt-text-secondary como cor de
// rótulo; o par ênfase/normal (e o par aba ativa/inativa da barra de navegação)
// difere por fundo, borda e peso — nunca por legibilidade.
//
// --mt-text-secondary é cor de texto AUXILIAR (ajuda, meta): sobre --mt-btn-bg
// ela mede 2,31 (void/light) a 5,14 (prism/dark) — reprova AA em 3 dos 4. Todo o
// resto do dashboard (TagManager, Channels, Playlists, Folders) já rotula botão
// com --mt-text-primary, que mede 13,79 a 16,44.

const AA = 4.5
const CRUZAMENTOS = [
  '.mytube-void.mytube-dark',
  '.mytube-void.mytube-light',
  '.mytube-prism.mytube-dark',
  '.mytube-prism.mytube-light',
]

const css = await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')

/** @returns {Record<string, Record<string, string>>} cruzamento -> token -> valor */
function lerTokens(fonte) {
  const out = {}
  for (const sel of CRUZAMENTOS) {
    const re = new RegExp(`^\\s*${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`, 'm')
    const m = re.exec(fonte)
    assert.ok(m, `tokens.css não tem o bloco ${sel}`)
    const vars = {}
    for (const [, nome, valor] of m[1].matchAll(/(--mt-[\w-]+)\s*:\s*([^;]+);/g)) vars[nome] = valor.trim()
    out[sel] = vars
  }
  return out
}

const TOKENS = lerTokens(css)

function canal(c) {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminancia(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  assert.ok(m, `esperava hex de 6 dígitos, recebi ${hex}`)
  const n = parseInt(m[1], 16)
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255)
}

function contraste(a, b) {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

/** Resolve `var(--mt-x)` no cruzamento dado. */
function resolver(expr, sel) {
  const m = /var\((--mt-[\w-]+)\)/.exec(expr)
  assert.ok(m, `esperava var(--mt-*) em ${JSON.stringify(expr)}`)
  const v = TOKENS[sel][m[1]]
  assert.ok(v, `${sel} não define ${m[1]}`)
  return v
}

/** Mede o rótulo contra o fundo nos 4 cruzamentos e cobra AA. */
function cobrarAA(quem, corExpr, fundoExpr) {
  for (const sel of CRUZAMENTOS) {
    const r = contraste(resolver(corExpr, sel), resolver(fundoExpr, sel))
    assert.ok(
      r >= AA,
      `${quem} em ${sel}: ${corExpr} sobre ${fundoExpr} = ${r.toFixed(2)} — reprova AA (${AA})`,
    )
  }
}

// A configuração de IA saiu do dashboard: o par ênfase/normal dela é medido na
// seção da sidebar (AISection), lá embaixo.

/** Extrai um bloco `nome: { ... }` do objeto de estilos. */
function bloco(fonte, nome) {
  const i = fonte.indexOf(`${nome}: {`)
  assert.ok(i >= 0, `não achei o estilo ${nome}`)
  const fim = fonte.indexOf('\n  }', i)
  assert.ok(fim > i, `bloco ${nome} sem fechamento`)
  return fonte.slice(i, fim)
}

function propriedade(blocoTxt, prop) {
  const m = new RegExp(`\\b${prop}:\\s*'([^']+)'`).exec(blocoTxt)
  assert.ok(m, `bloco não declara ${prop}`)
  return m[1]
}

// ─── dashboard: controles de App.tsx (abas + retry) ───────────────────────────
// A aba INATIVA da barra de navegação é controle interativo, não texto auxiliar.
// Ela pinta sobre o header, que é --mt-bg-secondary (NÃO --mt-btn-bg): com
// --mt-text-secondary mede 3,78 void/dark · 2,42 void/light · 5,74 prism/dark ·
// 3,61 prism/light — reprova AA em 3 dos 4, pior caso quase invisível.
// --mt-text-primary mede 15,18 a 17,18 nos mesmos 4, sem valor visual novo.

const app = await readFile(new URL('../src/dashboard/App.tsx', import.meta.url).pathname, 'utf8')

const navBtn = bloco(app, 'navBtn')
const navBtnActive = bloco(app, 'navBtnActive')
const retryBtn = bloco(app, 'retryBtn')

const corNavBtn = propriedade(navBtn, 'color')
assert.equal(
  corNavBtn.includes('--mt-text-secondary'), false,
  'App.tsx styles.navBtn rotula a aba INATIVA com --mt-text-secondary — cor de texto auxiliar, reprova AA sobre o --mt-bg-secondary do header',
)
assert.equal(
  corNavBtn, propriedade(navBtnActive, 'color'),
  'o par aba ativa/inativa tem de diferir por fundo e borda — não pela cor do rótulo',
)
cobrarAA('styles.navBtn', corNavBtn, 'var(--mt-bg-secondary)')

// navBtnActive e retryBtn pintam sobre --mt-accent-soft (rgba com alfa, só nos
// blocos de acento): esse fundo já foi medido nos 14 cruzamentos (pior caso
// 10,35). Aqui basta garantir que os dois rotulam com o MESMO token da ênfase.
for (const [quem, b] of [['styles.navBtnActive', navBtnActive], ['styles.retryBtn', retryBtn]]) {
  assert.ok(
    propriedade(b, 'color').includes('--mt-text-primary'),
    `App.tsx ${quem} deixou de rotular com --mt-text-primary`,
  )
}

// ─── sidebar: botões da seção IA (AISection) ──────────────────────────────────
// A seção de IA mora DENTRO do painel da engrenagem e reusa o optionBtnStyle do
// SettingsPanel, cujo rótulo é --mt-text-secondary na variante inativa (2,31 em
// void/light sobre --mt-btn-bg). Os botões da seção sobrescrevem para
// --mt-text-primary nas DUAS variantes: o par ênfase/normal difere por fundo,
// borda e peso — nunca por legibilidade.

const aiSection = await readFile(new URL('../src/content/sidebar/components/AISection.tsx', import.meta.url).pathname, 'utf8')

const mBtnStyle = /function btnStyle\(emphasis: boolean\): h\.JSX\.CSSProperties \{([\s\S]*?)\n\}/.exec(aiSection)
assert.ok(
  mBtnStyle,
  'AISection não tem mais o btnStyle único: sem ele cada botão inventa a própria cor de rótulo e a garantia de AA se dissolve',
)
const corBtn = /color:\s*'(var\(--mt-[\w-]+\))'/.exec(mBtnStyle[1])
assert.ok(
  corBtn,
  'btnStyle não sobrescreve a cor do rótulo: herdaria --mt-text-secondary de optionBtnStyle(false), que reprova AA sobre --mt-btn-bg',
)
assert.equal(
  corBtn[1], 'var(--mt-text-primary)',
  `btnStyle rotula com ${corBtn[1]} — o rótulo do par ênfase/normal é --mt-text-primary`,
)
// a variante de ÊNFASE não pode divergir: se o btnStyle escolhesse cor por
// `emphasis`, o par voltaria a diferir por legibilidade.
assert.equal(
  /emphasis\s*\?/.test(mBtnStyle[1]), false,
  `btnStyle escolhe a cor do rótulo pela variante:\n${mBtnStyle[1]}`,
)
assert.ok(
  /optionBtnStyle\(emphasis\)/.test(mBtnStyle[1]),
  'btnStyle deixou de derivar do optionBtnStyle do painel — a seção de IA passaria a ter botão com forma própria dentro da engrenagem',
)
// ênfase pinta sobre --mt-accent-soft (rgba com alfa, só nos blocos de acento),
// já medido nos 14 cruzamentos (pior caso 10,35); aqui mede-se a variante normal.
cobrarAA('AISection btnStyle', corBtn[1], 'var(--mt-btn-bg)')

// O Remover marca o perigo na BORDA, não no rótulo: var(--mt-error) sobre
// var(--mt-btn-bg) mede 4,43 em void/light e reprova AA por pouco.
const mDanger = /function dangerBtnStyle\(\): h\.JSX\.CSSProperties \{([\s\S]*?)\n\}/.exec(aiSection)
assert.ok(mDanger, 'AISection não tem mais o dangerBtnStyle do Remover')
const corDanger = /color:\s*'(var\(--mt-[\w-]+\))'/.exec(mDanger[1])
assert.ok(corDanger, 'dangerBtnStyle não declara a cor do rótulo')
cobrarAA('AISection dangerBtnStyle', corDanger[1], 'var(--mt-btn-bg)')
assert.ok(
  /border:\s*'1px solid var\(--mt-error\)'/.test(mDanger[1]),
  'o Remover perdeu a borda de erro — sem ela nada distingue o destrutivo dos outros botões',
)

// o comentário que justifica o par tem de medir CADA fundo: a medição da ênfase
// (sobre accent-soft) não vale como prova da variante normal (sobre btn-bg)
const doc = aiSection.slice(0, aiSection.indexOf('function btnStyle'))
for (const fundo of ['--mt-accent-soft', '--mt-btn-bg']) {
  assert.ok(
    doc.includes(fundo),
    `o comentário do par ênfase/normal não mede o rótulo sobre ${fundo} — uma medição só não cobre os dois fundos`,
  )
}

// A seção não pode teleportar o usuário para fora da sidebar.
assert.equal(
  /OPEN_OPTIONS_PAGE/.test(aiSection), false,
  'AISection ainda manda OPEN_OPTIONS_PAGE: a configuração de IA é a própria seção, não um botão que abre tela cheia',
)
const panel = await readFile(new URL('../src/content/sidebar/components/SettingsPanel.tsx', import.meta.url).pathname, 'utf8')
assert.equal(
  /OPEN_OPTIONS_PAGE/.test(panel), false,
  'SettingsPanel ainda manda OPEN_OPTIONS_PAGE: a interface do app é a sidebar',
)
assert.ok(
  /<AISection\s*\/>/.test(panel),
  'SettingsPanel não renderiza mais a <AISection/>: a configuração de IA sumiu do painel da engrenagem',
)

console.log(`✓ ai-button-label-contrast: rótulo ${corBtn[1]} passa AA nos ${CRUZAMENTOS.length} cruzamentos de base`)
