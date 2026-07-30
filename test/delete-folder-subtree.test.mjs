import assert from 'node:assert/strict'

// INVARIANTE: apagar uma pasta apaga a SUBÁRVORE inteira e não deixa órfão.
// Todo organizable que estava em qualquer pasta apagada volta para "sem pasta"
// (folderId: null), onde a árvore consegue mostrá-lo.
//
// O defeito que este teste reproduz: a versão recursiva lia o estado no começo,
// chamava a si mesma para cada filha (e cada chamada fazia o próprio get/set), e
// no fim gravava de volta a FOTO ANTIGA — desfazendo o que a recursão apagou. As
// subpastas ressuscitavam apontando para uma mãe inexistente, e como a árvore só
// renderiza a partir de parentId === null, elas e os canais dentro desapareciam
// da tela sem virar "sem pasta". Perda de dado silenciosa.

// O mock CLONA em get e em set, porque é o que o chrome.storage.local faz: ele
// serializa (structured clone), então cada get devolve um objeto NOVO. Um mock que
// devolve a mesma referência esconde justamente o defeito deste teste — todos os
// níveis da recursão passariam a mutar o mesmo objeto e o bug sumiria.
const store = {}
globalThis.chrome = {
  storage: {
    local: {
      get: async key => (typeof key === 'string'
        ? { [key]: structuredClone(store[key]) }
        : structuredClone(store)),
      set: async obj => { Object.assign(store, structuredClone(obj)) },
    },
  },
}
globalThis.crypto ??= (await import('node:crypto')).webcrypto

const { deleteFolder, getState } = await import('../src/shared/storage.ts')

const folder = (id, parentId) => ({ id, name: id, parentId, color: '#fff', createdAt: 1 })
const canal = (id, folderId) => ({
  id, youtubeId: `UC${id}`, type: 'channel', name: id, url: `https://youtube.com/@${id}`,
  folderId, tagIds: [], muted: true, addedAt: 1, lastSyncedAt: 1,
})

// A árvore: raiz -> (b, c); b -> d. Um canal em cada, mais um fora.
function semear() {
  store['mytube_state'] = {
    folders: [folder('raiz', null), folder('b', 'raiz'), folder('c', 'raiz'), folder('d', 'b')],
    organizables: [canal('ca', 'raiz'), canal('cb', 'b'), canal('cc', 'c'), canal('cd', 'd'), canal('fora', null)],
    tags: [],
  }
}

// ── 1. apagar a raiz leva a subárvore inteira, sem ressuscitar ninguém ───────
semear()
await deleteFolder('raiz')
let s = await getState()

assert.deepEqual(
  s.folders.map(f => f.id), [],
  `subpastas ressuscitaram: ${JSON.stringify(s.folders.map(f => ({ id: f.id, parentId: f.parentId })))}`,
)

// ── 2. nenhum canal ficou apontando para pasta que não existe mais ───────────
const idsVivos = new Set(s.folders.map(f => f.id))
const orfaos = s.organizables.filter(o => o.folderId !== null && !idsVivos.has(o.folderId))
assert.deepEqual(
  orfaos.map(o => ({ id: o.id, folderId: o.folderId })), [],
  'canais ficaram órfãos apontando para pasta inexistente — eles desaparecem da árvore',
)

// ── 3. os 4 canais que estavam nas pastas viraram "sem pasta", e nenhum sumiu ─
assert.equal(s.organizables.length, 5, 'algum organizable foi perdido')
for (const id of ['ca', 'cb', 'cc', 'cd']) {
  const o = s.organizables.find(x => x.id === id)
  assert.equal(o.folderId, null, `${id} não voltou para "sem pasta"`)
}
assert.equal(s.organizables.find(x => x.id === 'fora').folderId, null, 'canal de fora foi mexido')

// ── 4. apagar um nó do meio não toca os irmãos ───────────────────────────────
semear()
await deleteFolder('b')
s = await getState()
assert.deepEqual(
  s.folders.map(f => f.id).sort(), ['c', 'raiz'],
  'apagar o nó do meio levou irmão ou mãe junto',
)
assert.equal(s.organizables.find(x => x.id === 'cb').folderId, null, 'cb não voltou para "sem pasta"')
assert.equal(s.organizables.find(x => x.id === 'cd').folderId, null, 'cd (neto) não voltou para "sem pasta"')
assert.equal(s.organizables.find(x => x.id === 'ca').folderId, 'raiz', 'canal da mãe foi desanexado sem motivo')
assert.equal(s.organizables.find(x => x.id === 'cc').folderId, 'c', 'canal do irmão foi desanexado sem motivo')

// ── 5. ciclo em dado corrompido não trava ────────────────────────────────────
// Não é cenário esperado, mas um parentId circular travaria a recursão para sempre.
store['mytube_state'] = {
  folders: [folder('x', 'y'), folder('y', 'x')],
  organizables: [canal('cx', 'x')],
  tags: [],
}
await deleteFolder('x')
s = await getState()
assert.deepEqual(s.folders.map(f => f.id), [], 'ciclo de parentId não foi resolvido')
assert.equal(s.organizables[0].folderId, null)

console.log('✓ delete-folder-subtree: 13 asserções passaram')
