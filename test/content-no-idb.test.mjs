import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

// INVARIANTE: o IndexedDB só é aberto na origem da extensão.
//
// O bundle content.js roda DENTRO de www.youtube.com. Lá, `openDB('mytube')`
// resolve para o banco da ORIGEM DA PÁGINA, que scripts do youtube.com leem e
// escrevem, e que não é o banco que o poller lê. Então nenhum módulo alcançável
// a partir de src/content/** pode importar shared/db.ts nem o pacote `idb`
// (nem por `import()` dinâmico). O histórico de exibição é acessado pela sidebar
// por mensagens WATCH_* ao service worker.

const SRC = new URL('../src/', import.meta.url).pathname
const PROIBIDOS = [join(SRC, 'shared/db.ts')]

async function arquivos(dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await arquivos(p)))
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

// import x from '…', import '…', export … from '…' e import('…').
const SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g

async function resolverRelativo(de, spec) {
  const base = resolve(dirname(de), spec)
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    try {
      await readFile(c)
      if (/\.tsx?$/.test(c)) return c
    } catch { /* tenta o próximo */ }
  }
  return null
}

/** Grafo de imports (estáticos e dinâmicos) a partir de `raizes`. */
async function grafo(raizes) {
  const visitados = new Map() // arquivo -> specifiers que ele importa
  const fila = [...raizes]
  while (fila.length) {
    const arq = fila.pop()
    if (visitados.has(arq)) continue
    const texto = await readFile(arq, 'utf8')
    const specs = [...texto.matchAll(SPEC)].map(m => m[1])
    visitados.set(arq, specs)
    for (const s of specs) {
      if (!s.startsWith('.')) continue
      const alvo = await resolverRelativo(arq, s)
      if (alvo) fila.push(alvo)
    }
  }
  return visitados
}

async function violacoes(raizes) {
  const g = await grafo(raizes)
  const out = []
  for (const [arq, specs] of g) {
    for (const s of specs) {
      if (s === 'idb') out.push(`${relative(SRC, arq)} importa o pacote idb`)
      if (!s.startsWith('.')) continue
      const alvo = await resolverRelativo(arq, s)
      if (alvo && PROIBIDOS.includes(alvo)) out.push(`${relative(SRC, arq)} importa ${relative(SRC, alvo)}`)
    }
  }
  return out
}

// ── o guarda enxerga o que deve (senão ele passaria em branco) ──────────────

{
  const g = await grafo([join(SRC, 'background/index.ts')])
  assert.ok(
    [...g.keys()].some(f => f.endsWith('shared/db.ts')),
    'sanidade: a partir do worker o grafo deve alcançar shared/db.ts',
  )
}

// ── a invariante ────────────────────────────────────────────────────────────

const fontesContent = await arquivos(join(SRC, 'content'))
assert.ok(fontesContent.length > 10, 'sanidade: src/content/** foi encontrado')

assert.deepEqual(
  await violacoes(fontesContent),
  [],
  'código de src/content/** (bundle injetado no youtube.com) não pode alcançar shared/db.ts nem idb',
)

// O ExportImport da sidebar fala com o worker, em vez de abrir banco.
const exportImport = await readFile(join(SRC, 'content/sidebar/components/ExportImport.tsx'), 'utf8')
for (const tipo of ['WATCH_EXPORT', 'WATCH_IMPORT']) {
  assert.match(exportImport, new RegExp(`['"]${tipo}['"]`), `ExportImport deve usar a mensagem ${tipo}`)
}
assert.doesNotMatch(exportImport, /openDB|indexedDB/, 'ExportImport não abre IndexedDB')

console.log('ok content-no-idb')
