import assert from 'node:assert/strict'
import { buildPrompt, parseSuggestions } from '../src/background/ai/categorize.ts'

// INVARIANTE: o LOTE é a verdade, a resposta do modelo é palpite. Nada que o
// modelo devolva vira escrita sem casar com um item que foi realmente mandado.

const ITEMS = [
  { id: 'a', name: 'Fireship', type: 'channel' },
  { id: 'b', name: 'Lofi Girl', type: 'channel' },
  { id: 'c', name: 'Minhas receitas', type: 'playlist' },
]
const FOLDERS = [
  { id: 'f1', name: 'Programação' },
  { id: 'f2', name: 'Música' },
]

// ── pasta que já existe casa por nome, sem acento e sem caixa ─────────────────

const ok = parseSuggestions(
  '[{"n":1,"folder":"programacao"},{"n":2,"folder":"MÚSICA"},{"n":3,"folder":"Cozinha"}]',
  ITEMS, FOLDERS,
)
assert.deepEqual(ok, [
  { id: 'a', folderId: 'f1', newFolder: null, tags: [] },
  { id: 'b', folderId: 'f2', newFolder: null, tags: [] },
  // nenhuma pasta serviu: vira proposta de nome, nunca um id inventado
  { id: 'c', folderId: null, newFolder: 'Cozinha', tags: [] },
])

// ── o array vem cercado de conversa e de cerca markdown ──────────────────────

const sujo = parseSuggestions(
  'Claro! Aqui está:\n```json\n[{"n":1,"folder":"Programação"}]\n```\nEspero ter ajudado.',
  ITEMS, FOLDERS,
)
assert.deepEqual(sujo, [{ id: 'a', folderId: 'f1', newFolder: null, tags: [] }])

// ── lixo não vira escrita ────────────────────────────────────────────────────

assert.deepEqual(parseSuggestions('não sei responder isso', ITEMS, FOLDERS), [])
assert.deepEqual(parseSuggestions('[{"n":99,"folder":"X"}]', ITEMS, FOLDERS), [], 'índice fora da faixa')
assert.deepEqual(parseSuggestions('[{"n":1}]', ITEMS, FOLDERS), [], 'sem nome de pasta')
assert.deepEqual(parseSuggestions('[{"n":1,"folder":"   "}]', ITEMS, FOLDERS), [], 'nome só de espaço')
assert.deepEqual(parseSuggestions('[{"n":"1","folder":"X"}]', ITEMS, FOLDERS), [], 'índice não numérico')
assert.deepEqual(parseSuggestions('[null,3,"x"]', ITEMS, FOLDERS), [], 'entradas que não são objeto')
assert.deepEqual(parseSuggestions('[{"n":1,"folder":"A"},{"n":1,"folder":"B"}]', ITEMS, FOLDERS).length, 1,
  'item repetido só conta uma vez')

// ── sem pasta nenhuma, tudo é proposta nova ──────────────────────────────────

assert.deepEqual(
  parseSuggestions('[{"n":1,"folder":"Tech"}]', ITEMS, []),
  [{ id: 'a', folderId: null, newFolder: 'Tech', tags: [] }],
)

// ── tags: teto de 3, dedup sem acento nem caixa, lixo descartado ─────────────
//
// O teto está no prompt E aqui: prompt é pedido, não garantia. Dez tags por
// canal não é organização, é ruído.

const comTags = parseSuggestions(
  '[{"n":1,"folder":"Programação","tags":["Iniciante","INICIANTE","iniciante","Inglês","Longo","Extra"]}]',
  ITEMS, FOLDERS,
)
assert.deepEqual(comTags[0].tags, ['Iniciante', 'Inglês', 'Longo'], 'esperava dedup e corte em 3')

assert.deepEqual(
  parseSuggestions('[{"n":1,"folder":"Programação","tags":"nao e lista"}]', ITEMS, FOLDERS)[0].tags,
  [], 'tags que não são lista viram lista vazia, não exceção',
)
assert.deepEqual(
  parseSuggestions('[{"n":1,"folder":"Programação","tags":[null,3,"  ","ok"]}]', ITEMS, FOLDERS)[0].tags,
  ['ok'], 'entradas que não são texto são descartadas',
)

// o prompt precisa ENSINAR a diferença entre tag e pasta, senão vira pasta duplicada
const promptComTags = buildPrompt(ITEMS, FOLDERS, [{ id: 't1', name: 'Iniciante' }])
assert.match(promptComTags, /TAGS QUE JÁ EXISTEM:\n- Iniciante/)
assert.match(promptComTags, /atravessa pastas/, 'o prompt não explica o que distingue tag de pasta')
assert.match(buildPrompt(ITEMS, FOLDERS), /TAGS QUE JÁ EXISTEM:\n\(nenhuma ainda\)/)

// ── o prompt referencia por POSIÇÃO, não por id ──────────────────────────────

const prompt = buildPrompt(ITEMS, FOLDERS)
assert.match(prompt, /1\. \[channel\] Fireship/)
assert.match(prompt, /3\. \[playlist\] Minhas receitas/)
assert.match(prompt, /- Programação/)
assert.equal(/\bid\b.*'a'/.test(prompt), false, 'o id do item não pode vazar para o prompt')
assert.match(buildPrompt(ITEMS, []), /nenhuma ainda/, 'biblioteca sem pastas precisa dizer isso ao modelo')

console.log('✓ ai-categorize-parse: 15 asserções passaram')
