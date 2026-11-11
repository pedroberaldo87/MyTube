import assert from 'node:assert/strict'
import {
  isYouTubeUrl,
  isYouTubeImageUrl,
  safeYouTubeHref,
  safeImageSrc,
  sanitizeBackupCollections,
  sanitizeState,
  sanitizeWatchEntries,
  collectWatchedVideoIds,
} from '../src/shared/backup-validate.ts'

// INVARIANTE: um backup importado (dashboard ou sidebar) passa por UM validador
// por elemento antes de tocar o storage, e o estado lido do storage passa pelo
// mesmo validador. Antes, os dois importadores só checavam que os quatro campos
// de topo eram arrays: `url` e `thumbnailUrl` chegavam crus ao fetch do
// service worker, ao `location.href` do botão de desinscrever e ao `<a href>`;
// uma entrada sem `tagIds` derrubava a renderização; um `null` no histórico
// derrubava o poller.

const canal = (over = {}) => ({
  id: 'org-1', type: 'channel', youtubeId: 'UCexample0000000000000001', name: 'Canal Exemplo',
  thumbnailUrl: 'https://yt3.ggpht.com/example=s176-c-k-c0x00ffffff-no-rj',
  url: 'https://www.youtube.com/@exemplo', folderId: 'f-1', tagIds: ['t-1'],
  isSubscribed: true, addedAt: 1700000000000, lastSyncedAt: 1700000001000,
  handle: 'exemplo', muted: false, ...over,
})
const playlist = (over = {}) => ({
  id: 'org-2', type: 'playlist', youtubeId: 'PLexample', name: 'Lista',
  thumbnailUrl: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg?sqp=x&rs=y',
  url: 'https://www.youtube.com/playlist?list=PLexample', folderId: null, tagIds: [],
  isSubscribed: false, addedAt: 1, lastSyncedAt: 2, ...over,
})
const video = (over = {}) => ({
  id: 'org-3', type: 'video', youtubeId: 'aaaaaaaaaaa', name: 'Vídeo', channelName: 'Canal Exemplo',
  thumbnailUrl: '', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', folderId: 'f-1',
  tagIds: ['t-1'], isSubscribed: false, addedAt: 3, lastSyncedAt: 4, ...over,
})
const pasta = (over = {}) => ({ id: 'f-1', name: 'Pasta', parentId: null, color: '#ff0000', order: 0, ...over })
const tag = (over = {}) => ({ id: 't-1', name: 'Tag', color: '#00ff00', ...over })
const visto = (over = {}) => ({ videoId: 'aaaaaaaaaaa', channelId: 'UCexample0000000000000001', title: 'Vídeo', watchedAt: 1700000002000, ...over })

const backupReal = () => ({
  organizables: [canal(), playlist(), video()],
  folders: [pasta(), pasta({ id: 'f-2', parentId: 'f-1', order: 1 })],
  tags: [tag()],
  watchHistory: [visto(), visto({ videoId: 'bbbbbbbbbbb' })],
})

// ── um backup com a forma real passa SEM mudar ──────────────────────────────

{
  const entrada = backupReal()
  const r = sanitizeBackupCollections(structuredClone(entrada))
  assert.ok(r, 'backup com forma real foi rejeitado')
  assert.deepEqual(r.organizables, entrada.organizables)
  assert.deepEqual(r.folders, entrada.folders)
  assert.deepEqual(r.tags, entrada.tags)
  assert.deepEqual(r.watchHistory, entrada.watchHistory)
  assert.deepEqual(r.dropped, { organizables: 0, folders: 0, tags: 0, watchHistory: 0 })
}

// ── forma de topo inválida é rejeitada (nada é escrito) ─────────────────────

for (const ruim of [null, 'x', 42, [], {}, { organizables: [], folders: [], tags: [] },
  { organizables: {}, folders: [], tags: [], watchHistory: [] }]) {
  assert.equal(sanitizeBackupCollections(ruim), null, `deveria rejeitar ${JSON.stringify(ruim)}`)
}

// ── url: só https em youtube.com / www.youtube.com ──────────────────────────

const urlsRuins = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'http://www.youtube.com/@exemplo',
  'http://127.0.0.1:8080/x?',
  'https://evil.example/',
  'https://www.youtube.com.evil.example/',
  'https://evilyoutube.com/',
  'https://www.youtube.com@evil.example/',
  'https://user:pw@www.youtube.com/@exemplo',
  'https://www.youtube.com:8443/@exemplo',
  'https://music.youtube.com/@exemplo',
  'https://m.youtube.com/@exemplo',
  'file:///etc/passwd',
  '//evil.example/',
  '/@exemplo',
  '',
  null,
  undefined,
  42,
  { href: 'https://www.youtube.com/' },
]
for (const url of urlsRuins) {
  assert.equal(isYouTubeUrl(url), false, `isYouTubeUrl aceitou ${JSON.stringify(url)}`)
  assert.equal(safeYouTubeHref(url), undefined, `safeYouTubeHref aceitou ${JSON.stringify(url)}`)
  const r = sanitizeBackupCollections({ ...backupReal(), organizables: [canal(), canal({ id: 'x', youtubeId: 'UCx', url })] })
  assert.ok(r)
  assert.equal(r.organizables.length, 1, `organizable com url ${JSON.stringify(url)} não foi descartado`)
  assert.equal(r.organizables[0].id, 'org-1')
  assert.equal(r.dropped.organizables, 1)
}
for (const ok of ['https://www.youtube.com/@exemplo', 'https://youtube.com/@exemplo',
  'https://www.youtube.com/channel/UCexample0000000000000001', 'https://www.youtube.com/playlist?list=PLabc',
  'https://www.youtube.com/watch?v=aaaaaaaaaaa', 'https://WWW.YOUTUBE.COM/@exemplo']) {
  assert.equal(isYouTubeUrl(ok), true, `isYouTubeUrl recusou ${ok}`)
  assert.equal(safeYouTubeHref(ok), ok)
}

// ── thumbnailUrl: https em host de imagem do YouTube, senão vira '' ─────────

for (const t of ['https://evil.example/p.png', 'http://i.ytimg.com/vi/a/b.jpg', 'javascript:alert(1)',
  'data:image/svg+xml,<svg onload=alert(1)>', 'https://i.ytimg.com.evil.example/a.jpg',
  'https://127.0.0.1:8080/x', 'https://www.youtube.com/a.jpg', 42, null, {}]) {
  assert.equal(isYouTubeImageUrl(t), false, `isYouTubeImageUrl aceitou ${JSON.stringify(t)}`)
  assert.equal(safeImageSrc(t), undefined)
  const r = sanitizeBackupCollections({ ...backupReal(), organizables: [canal({ thumbnailUrl: t })] })
  assert.ok(r)
  assert.equal(r.organizables.length, 1, 'thumbnail inválida não derruba o item')
  assert.equal(r.organizables[0].thumbnailUrl, '')
}
for (const host of ['i.ytimg.com', 'i9.ytimg.com', 'yt3.ggpht.com', 'yt3.googleusercontent.com']) {
  assert.equal(isYouTubeImageUrl(`https://${host}/vi/x/hq.jpg?a=b`), true, host)
}
assert.equal(
  sanitizeBackupCollections({ ...backupReal(), organizables: [canal({ thumbnailUrl: '//yt3.ggpht.com/a=s88' })] })
    .organizables[0].thumbnailUrl,
  'https://yt3.ggpht.com/a=s88',
  'URL sem protocolo (como o YouTube às vezes entrega) é normalizada para https',
)

// ── null, tipos errados e campos faltando não derrubam o import ─────────────

{
  const r = sanitizeBackupCollections({
    organizables: [null, 7, 'x', [], canal(), canal({ id: 'sem-tipo', type: 'shorts' }), canal({ id: undefined })],
    folders: [null, pasta(), 'x', { name: 'sem id' }],
    tags: [null, tag(), 3, { id: 5 }],
    watchHistory: [null, undefined, 3, 'x', [], visto(), { videoId: 5 }, { videoId: 'sem-data' }],
  })
  assert.ok(r)
  assert.equal(r.organizables.length, 1)
  assert.equal(r.folders.length, 1)
  assert.equal(r.tags.length, 1)
  assert.equal(r.watchHistory.length, 1)
  assert.equal(r.dropped.organizables, 6)
  assert.equal(r.dropped.folders, 3)
  assert.equal(r.dropped.tags, 3)
  assert.equal(r.dropped.watchHistory, 7)
}

// ── campos faltando recebem default (o bug de `tagIds` ausente) ─────────────

{
  const cru = { id: 'o', type: 'channel', youtubeId: 'UCx', url: 'https://www.youtube.com/@x' }
  const r = sanitizeBackupCollections({ organizables: [cru], folders: [{ id: 'f' }], tags: [{ id: 't' }], watchHistory: [] })
  assert.ok(r)
  const o = r.organizables[0]
  assert.deepEqual(o.tagIds, [])
  assert.equal(o.folderId, null)
  assert.equal(o.name, '')
  assert.equal(o.thumbnailUrl, '')
  assert.equal(o.isSubscribed, false)
  assert.equal(typeof o.addedAt, 'number')
  assert.equal(typeof o.lastSyncedAt, 'number')
  assert.equal('muted' in o, false, 'muted ausente continua ausente')
  assert.equal(r.folders[0].parentId, null)
  assert.equal(typeof r.folders[0].name, 'string')
  assert.equal(typeof r.folders[0].color, 'string')
  assert.equal(typeof r.folders[0].order, 'number')
  assert.equal(typeof r.tags[0].name, 'string')
  assert.equal(typeof r.tags[0].color, 'string')
}
{
  // tagIds com lixo: só strings ficam; tipos errados em campos opcionais saem.
  const r = sanitizeBackupCollections({
    organizables: [canal({ tagIds: ['a', 5, null, 'b'], muted: 'yes', handle: 7, channelName: {}, isSubscribed: 'sim' })],
    folders: [], tags: [], watchHistory: [],
  })
  const o = r.organizables[0]
  assert.deepEqual(o.tagIds, ['a', 'b'])
  assert.equal('muted' in o, false)
  assert.equal('handle' in o, false)
  assert.equal('channelName' in o, false)
  assert.equal(o.isSubscribed, false)
}
{
  // `tagIds` que nem array é: vira [] e o item continua utilizável.
  const r = sanitizeBackupCollections({
    organizables: [canal({ tagIds: 'x' }), canal({ id: 'o2', youtubeId: 'UC2', tagIds: undefined })],
    folders: [], tags: [], watchHistory: [],
  })
  assert.deepEqual(r.organizables.map(o => o.tagIds), [[], []])
}

// ── campos extras (inclusive __proto__) não vazam para o estado ─────────────

{
  const r = sanitizeBackupCollections(JSON.parse(
    '{"organizables":[{"id":"o","type":"channel","youtubeId":"UCx","url":"https://www.youtube.com/@x","evil":"1","__proto__":{"polluted":true}}],"folders":[],"tags":[],"watchHistory":[]}',
  ))
  assert.equal('evil' in r.organizables[0], false)
  assert.equal(r.organizables[0].polluted, undefined)
  assert.equal({}.polluted, undefined)
}

// ── sanitizeState: o que sai do storage ─────────────────────────────────────

{
  const s = sanitizeState(undefined)
  assert.deepEqual(s, { organizables: [], folders: [], tags: [] })
  s.organizables.push(canal())
  assert.deepEqual(sanitizeState(undefined).organizables, [], 'o estado vazio não pode ser compartilhado entre chamadas')
  for (const lixo of [null, 'x', 5, [], { organizables: 'x', folders: null, tags: 3 }]) {
    assert.deepEqual(sanitizeState(lixo), { organizables: [], folders: [], tags: [] })
  }
}
{
  const guardado = {
    organizables: [canal(), null, canal({ id: 'mal', youtubeId: 'UCm', url: 'https://evil.example/' }), canal({ id: 'sem-tag', youtubeId: 'UCs', tagIds: undefined })],
    folders: [pasta(), null], tags: [tag(), null],
    deletedYoutubeIds: ['channel:UCold', 5, null],
    newVideoCounts: { UCx: 3, UCy: 'many', UCz: NaN },
  }
  const s = sanitizeState(guardado)
  assert.deepEqual(s.organizables.map(o => o.id), ['org-1', 'sem-tag'])
  assert.deepEqual(s.organizables[1].tagIds, [])
  assert.equal(s.folders.length, 1)
  assert.equal(s.tags.length, 1)
  assert.deepEqual(s.deletedYoutubeIds, ['channel:UCold'])
  assert.deepEqual(s.newVideoCounts, { UCx: 3 })
}
{
  // estado saudável: round-trip idêntico, sem inventar chaves opcionais
  const saudavel = { organizables: [canal(), playlist(), video()], folders: [pasta()], tags: [tag()] }
  assert.deepEqual(sanitizeState(structuredClone(saudavel)), saudavel)
}

// ── histórico de exibição ───────────────────────────────────────────────────

{
  const { entries, dropped } = sanitizeWatchEntries([null, visto(), undefined, { videoId: 'x', watchedAt: 'ontem' }, visto({ videoId: 'ccccccccccc', title: undefined, channelId: undefined })])
  assert.equal(entries.length, 2)
  assert.equal(dropped, 3)
  assert.equal(entries[1].title, '')
  assert.equal(entries[1].channelId, '')
}
assert.deepEqual([...collectWatchedVideoIds([null, undefined, 'x', 3, [], { videoId: 5 }, { videoId: 'aaaaaaaaaaa' }, visto({ videoId: 'bbbbbbbbbbb' })])].sort(),
  ['aaaaaaaaaaa', 'bbbbbbbbbbb'], 'registro nulo no IndexedDB não pode derrubar getWatchedVideoIds')

console.log('backup-validate: ok')
