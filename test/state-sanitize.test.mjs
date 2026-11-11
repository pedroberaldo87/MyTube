import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// INVARIANTE: o estado lido do storage passa pelo validador por elemento, e os
// dois importadores usam o MESMO validador (não cada um o seu `Array.isArray`).
// Antes: uma entrada sem `tagIds` no storage derrubava a renderização do
// dashboard e da sidebar até limpar os dados da extensão.

const store = {}
globalThis.chrome = {
  storage: {
    local: {
      get: async key => ({ [key]: structuredClone(store[key]) }),
      set: async obj => { Object.assign(store, structuredClone(obj)) },
    },
  },
}
globalThis.crypto ??= (await import('node:crypto')).webcrypto

const { getState, setState } = await import('../src/shared/storage.ts')

const canal = (over = {}) => ({
  id: 'o1', type: 'channel', youtubeId: 'UCexample0000000000000001', name: 'Canal Exemplo',
  thumbnailUrl: 'https://yt3.ggpht.com/example', url: 'https://www.youtube.com/@exemplo',
  folderId: null, tagIds: [], isSubscribed: true, addedAt: 1, lastSyncedAt: 2, muted: false, ...over,
})

// storage vazio → estado vazio, e um objeto novo a cada chamada
{
  delete store.mytube_state
  const a = await getState()
  a.organizables.push(canal())
  assert.deepEqual((await getState()).organizables, [])
}

// entradas tortas saem; as boas ficam; a que perdeu tagIds ganha []
{
  store.mytube_state = {
    organizables: [
      canal(),
      null,
      canal({ id: 'o2', youtubeId: 'UC2', tagIds: undefined }),
      canal({ id: 'o3', youtubeId: 'UC3', url: 'https://evil.example/' }),
      canal({ id: 'o4', youtubeId: 'UC4', url: 'javascript:alert(1)' }),
    ],
    folders: [{ id: 'f', name: 'P', parentId: null, color: '#fff', order: 0 }, null],
    tags: [null, { id: 't', name: 'T', color: '#000' }],
  }
  const s = await getState()
  assert.deepEqual(s.organizables.map(o => o.id), ['o1', 'o2'])
  assert.deepEqual(s.organizables[1].tagIds, [])
  assert.equal(s.folders.length, 1)
  assert.equal(s.tags.length, 1)
  await setState(s)
  assert.equal(store.mytube_state.organizables.length, 2, 'a regravação persiste o estado limpo')
}

// estado saudável: round-trip idêntico
{
  const saudavel = { organizables: [canal()], folders: [], tags: [] }
  store.mytube_state = structuredClone(saudavel)
  assert.deepEqual(await getState(), saudavel)
}

// os dois importadores usam o validador compartilhado e não o Array.isArray antigo
for (const f of ['src/content/sidebar/components/ExportImport.tsx', 'src/dashboard/pages/Settings.tsx']) {
  const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
  assert.match(src, /sanitizeBackupCollections\(/, `${f} não chama sanitizeBackupCollections`)
  assert.doesNotMatch(src, /isValidBackup|isImportPayload/, `${f} ainda tem o validador antigo`)
}

console.log('state-sanitize: ok')
