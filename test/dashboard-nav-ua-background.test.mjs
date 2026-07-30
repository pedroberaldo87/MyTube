import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// INVARIANTE: nenhum elemento do dashboard herda cor de fundo do UA. Todo estado
// base declara backgroundColor explícito, e a única aba com fundo destacado é a
// ativa. `background: 'none'` NÃO segura isso: o shorthand é expandido em
// longhands na hora do parse, então quando o Preact remove o backgroundColor do
// estado ativo não sobra ninguém declarando a cor de fundo e o botão cai no
// buttonface do UA (rgb(239,239,239)) — uma pílula clara que, em tema escuro,
// grita "selecionada" mais alto que a aba realmente selecionada.

const APP = new URL('../src/dashboard/App.tsx', import.meta.url).pathname
const PREACT = new URL('../node_modules/preact/dist/preact.umd.js', import.meta.url).pathname

const src = await readFile(APP, 'utf8')
const preactUmd = await readFile(PREACT, 'utf8')

function styleObject(name) {
  // captura `name: { ... },` do objeto `styles` do App.tsx
  const m = new RegExp(`\\n  ${name}: \\{\\n([\\s\\S]*?)\\n  \\},`).exec(src)
  assert.ok(m, `não achei o bloco de estilo ${name} em src/dashboard/App.tsx`)
  return new Function(`return {\n${m[1]}\n}`)()
}

const navStyle = styleObject('nav')
const baseStyle = styleObject('navBtn')
const activeStyle = styleObject('navBtnActive')

const LABELS = ['Channels', 'Playlists', 'Folders', 'Settings']
const TRANSPARENT = 'rgba(0, 0, 0, 0)'

const browser = await chromium.launch()
let states
try {
  const page = await browser.newPage()
  // os tokens PRECISAM existir, senão var(--mt-accent-soft) é inválido em tempo
  // de computação e a aba ativa também mediria transparente, escondendo o
  // defeito. Cores aqui são fixture, não tema.
  await page.setContent(
    '<!doctype html><html><head><style>:root{--mt-accent:#0088ff;--mt-accent-soft:#dceeff;' +
    '--mt-text-primary:#000000;--mt-text-secondary:#666666}</style></head>' +
    '<body style="margin:0"><div id="app"></div></body></html>',
  )
  await page.addScriptTag({ content: preactUmd })

  // Preact REAL faz o diff: ao trocar de aba ele remove do style inline as chaves
  // que saíram (backgroundColor) e não reescreve as que não mudaram (background).
  states = await page.evaluate(
    async ({ navStyle, baseStyle, activeStyle, labels }) => {
      const { h, render } = window.preact
      const root = document.getElementById('app')
      const tree = active =>
        h('nav', { style: navStyle },
          labels.map((label, i) =>
            h('button', {
              key: label,
              style: { ...baseStyle, ...(i === active ? activeStyle : {}) },
            }, label),
          ),
        )
      // a medição precisa esperar a transição de 0.15s terminar: no instante do
      // render o getComputedStyle devolve o valor interpolado, não o de repouso
      const settle = () => new Promise(r => setTimeout(r, 400))
      const measure = () =>
        [...root.querySelectorAll('button')].map(b => getComputedStyle(b).backgroundColor)

      const out = []
      // sequência de cliques do humano: entra na primeira aba e vai trocando
      for (const active of [0, 1, 2, 3, 0]) {
        render(tree(active), root)
        await settle()
        out.push({ active, bg: measure() })
      }
      return out
    },
    { navStyle, baseStyle, activeStyle, labels: LABELS },
  )
} finally {
  await browser.close()
}

let checados = 0
for (const { active, bg } of states) {
  for (let i = 0; i < LABELS.length; i++) {
    if (i === active) {
      assert.notEqual(
        bg[i], TRANSPARENT,
        `com ${LABELS[active]} ativa, a própria aba ativa ficou sem fundo destacado`,
      )
    } else {
      assert.equal(
        bg[i], TRANSPARENT,
        `com ${LABELS[active]} ativa, a aba inativa ${LABELS[i]} tem fundo ${bg[i]} — ` +
        `herdou a cor do UA e disputa a leitura de "selecionada" com a aba ativa`,
      )
    }
    checados++
  }
}

console.log(`✓ dashboard-nav-ua-background: ${checados} fundos medidos, 0 herdado do UA`)
