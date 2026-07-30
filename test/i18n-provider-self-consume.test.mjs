import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

// INVARIANTE: nenhum módulo MONTA o I18nContext.Provider e chama useT() ao mesmo
// tempo. Um componente não vê o próprio Provider — ele lê o default 'en'.
//
// Prova do defeito, da revisão: Sidebar.tsx montava o Provider no return e chamava
// useT() no corpo, então a MESMA chave rendia "Select" no cabeçalho da sidebar e
// "Selecionar" na Library, na mesma tela, com o idioma em pt-BR. É silencioso: não
// quebra, não avisa, só mostra metade da interface na língua errada.
//
// Quem tem o idioma no estado usa a forma standalone `t(key, lang)`; quem está
// DENTRO do Provider usa useT().

const SRC = new URL('../src/', import.meta.url).pathname

async function arquivos(dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...await arquivos(p))
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

/** Sem comentários: senão o próprio comentário que EXPLICA o defeito dispara o
 *  guarda. Aconteceu ao escrever este teste. */
function semComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const todos = await arquivos(SRC)
assert.ok(todos.length >= 30, `esperava os fontes do projeto, achei ${todos.length}`)

let comProvider = 0
for (const f of todos) {
  const src = semComentarios(await readFile(f, 'utf8'))
  const rel = f.slice(SRC.length)
  const montaProvider = /I18nContext\.Provider/.test(src) || /h\(\s*I18nContext\.Provider/.test(src)
  if (!montaProvider) continue
  comProvider++
  assert.equal(
    /\buseT\s*\(\s*\)/.test(src), false,
    `${rel} monta o I18nContext.Provider E chama useT() — não vê o próprio Provider, `
    + `então lê o default 'en' e a tela sai metade traduzida`,
  )
}
assert.ok(comProvider >= 3, `esperava ao menos 3 módulos montando o Provider (sidebar, feed, dashboard), achei ${comProvider}`)

// ── a forma standalone entrega mesmo o idioma pedido ─────────────────────────
const { t } = await import('../src/shared/i18n.ts')
assert.equal(t('library.select', 'pt-BR'), 'Selecionar', 'a forma standalone não devolveu pt-BR')
assert.equal(t('library.select', 'en'), 'Select')
assert.notEqual(
  t('library.select', 'pt-BR'), t('library.select', 'en'),
  'a chave usada como prova do defeito é igual nas duas línguas — troque a chave do teste',
)

console.log(`✓ i18n-provider-self-consume: ${comProvider} módulos com Provider checados, 6 asserções`)
