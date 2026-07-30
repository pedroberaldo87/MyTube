import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

// INVARIANTE: o dashboard consome o MESMO design system da sidebar. Nenhum hex
// hardcoded do conjunto antigo, nenhum import do tokens.ts que foi apagado.
// Sem este guarda, um arquivo novo reintroduz o tema paralelo em silêncio.

const ROOT = new URL('../src/dashboard/', import.meta.url).pathname
const HEX_ANTIGOS = ['#3ea6ff', '#065fd4', '#0f0f0f', '#272727', '#f2f2f2', '#d9d9d9', '#aaaaaa', '#606060', '#f1f1f1', '#3f3f3f']

async function tsxFiles(dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...await tsxFiles(p))
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

const files = await tsxFiles(ROOT)
// Piso 7: a configuração de IA saiu do dashboard para a sidebar (o painel da
// engrenagem é a interface do app), levando dois arquivos com ela.
// O piso existe só para o guarda não passar em silêncio sobre pasta vazia.
assert.ok(files.length >= 7, `esperava os arquivos do dashboard, achei ${files.length}`)

let checados = 0
for (const f of files) {
  const src = await readFile(f, 'utf8')
  const rel = f.slice(ROOT.length)
  for (const hex of HEX_ANTIGOS) {
    assert.equal(
      src.toLowerCase().includes(hex), false,
      `${rel} traz o hex hardcoded ${hex} — o dashboard tem de usar var(--mt-*)`,
    )
  }
  assert.equal(
    /from '\.{1,2}\/tokens'/.test(src), false,
    `${rel} ainda importa o tokens.ts, que foi apagado em favor do tokens.css`,
  )
  checados++
}

// o tokens.ts realmente não existe mais
let existe = true
try { await readFile(join(ROOT, 'tokens.ts'), 'utf8') } catch { existe = false }
assert.equal(existe, false, 'src/dashboard/tokens.ts ainda existe')

// e o tokens.css resolve fora de Shadow DOM
const css = await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')
for (const sel of ['.mytube-void.mytube-dark', '.mytube-prism.mytube-light', '.mytube-prism.mytube-dark.mytube-accent-coral', '.mytube-prism.mytube-light.mytube-accent-gold']) {
  assert.ok(
    new RegExp(`^\\s*${sel.replace(/\./g, '\\.')}\\s*[,{]`, 'm').test(css),
    `tokens.css não tem o seletor de classe ${sel} — os tokens não resolvem fora de Shadow DOM`,
  )
}

console.log(`✓ dashboard-theme-guard: ${checados} arquivos checados, 0 hex antigo`)
