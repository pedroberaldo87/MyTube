import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// INVARIANTE: alternar ativo/inativo não muda a geometria. O getBoundingClientRect
// de cada aba é idêntico nos dois estados, e as abas vizinhas não se movem ao
// trocar de aba. Sem isso a barra "pula": a borda de 2px e o peso 600 entram e
// saem da caixa a cada clique.

const APP = new URL('../src/dashboard/App.tsx', import.meta.url).pathname
const src = await readFile(APP, 'utf8')

// as chaves CSS numéricas que NÃO levam px (subconjunto do que o Preact trata)
const UNITLESS = new Set(['fontWeight', 'lineHeight', 'zIndex', 'opacity', 'flex', 'flexGrow', 'flexShrink', 'order'])

function styleObject(name) {
  // captura `name: { ... },` do objeto `styles` do App.tsx
  const m = new RegExp(`\\n  ${name}: \\{\\n([\\s\\S]*?)\\n  \\},`).exec(src)
  assert.ok(m, `não achei o bloco de estilo ${name} em src/dashboard/App.tsx`)
  return new Function(`return {\n${m[1]}\n}`)()
}

function toCss(obj) {
  return Object.entries(obj)
    .map(([k, v]) => {
      const prop = k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)
      const val = typeof v === 'number' && !UNITLESS.has(k) ? `${v}px` : String(v)
      return `${prop}: ${val}`
    })
    .join('; ')
}

const navCss = toCss(styleObject('nav'))
const baseCss = toCss(styleObject('navBtn'))
const activeCss = toCss(styleObject('navBtnActive'))

const LABELS = ['Channels', 'Playlists', 'Folders', 'Settings']

const browser = await chromium.launch()
let rectsByState
try {
  const page = await browser.newPage()
  // os tokens PRECISAM existir: `border: 2px solid var(--mt-accent)` com a var
  // ausente é inválido em tempo de computação e a borda simplesmente não pinta,
  // o que esconderia os 4px do defeito. Cores aqui são fixture, não tema.
  await page.setContent(
    '<!doctype html><html><head><style>:root{--mt-accent:#0088ff;--mt-accent-soft:#dceeff;' +
    '--mt-text-primary:#000000;--mt-text-secondary:#666666}</style></head>' +
    '<body style="margin:0"><nav id="nav"></nav></body></html>',
  )
  rectsByState = await page.evaluate(
    ({ navCss, baseCss, activeCss, labels }) => {
      const nav = document.getElementById('nav')
      nav.setAttribute('style', navCss)
      const btns = labels.map(l => {
        const b = document.createElement('button')
        b.textContent = l
        nav.appendChild(b)
        return b
      })
      const paint = active => {
        btns.forEach((b, i) => {
          b.setAttribute('style', i === active ? `${baseCss}; ${activeCss}` : baseCss)
        })
        return btns.map(b => {
          const r = b.getBoundingClientRect()
          return { x: +r.x.toFixed(3), width: +r.width.toFixed(3), height: +r.height.toFixed(3) }
        })
      }
      // -1 = nenhuma aba ativa (linha de base), depois cada aba ativa por vez
      return [-1, 0, 1, 2, 3].map(a => ({ active: a, rects: paint(a) }))
    },
    { navCss, baseCss, activeCss, labels: LABELS },
  )
} finally {
  await browser.close()
}

const base = rectsByState[0].rects
let checados = 0
for (const { active, rects } of rectsByState.slice(1)) {
  for (let i = 0; i < LABELS.length; i++) {
    const quem = i === active ? 'a própria aba ativa' : `a aba vizinha ${LABELS[i]}`
    assert.deepEqual(
      rects[i], base[i],
      `com ${LABELS[active]} ativa, ${quem} mudou de geometria: ` +
      `${JSON.stringify(base[i])} -> ${JSON.stringify(rects[i])} — a barra pula a cada clique`,
    )
    checados++
  }
}

console.log(`✓ dashboard-nav-geometry: ${checados} retângulos medidos, 0 deslocamento`)
