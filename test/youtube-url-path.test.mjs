import assert from 'node:assert/strict'
import {
  isYouTubeUrl, isYouTubeChannelUrl, isYouTubeReturnUrl, safeYouTubeHref, sanitizeBackupCollections,
} from '../src/shared/backup-validate.ts'

// INVARIANT: a stored organizable URL is a youtube.com page the app itself
// produces: a channel (/channel/<id>, /@handle, /c/<name>, /user/<name>), a
// playlist (/playlist?list=), a video (/watch?v=, /shorts/<id>). Anything else on
// the same host (/redirect?q=..., /logout, /feed/..., the root) is refused, because
// the worker `fetch` and the top-frame navigation would otherwise issue an
// arbitrary GET to any youtube.com path.

const accepted = [
  'https://www.youtube.com/@exemplo',
  'https://youtube.com/@exemplo',
  'https://www.youtube.com/@exemplo/videos',
  'https://www.youtube.com/@exemplo/',
  'https://www.youtube.com/channel/UCexample0000000000000001',
  'https://www.youtube.com/channel/UCexample0000000000000001/videos',
  'https://www.youtube.com/channel/legacy-id',
  'https://www.youtube.com/c/exemplo',
  'https://www.youtube.com/user/exemplo',
  'https://www.youtube.com/playlist?list=PLabc',
  'https://www.youtube.com/watch?v=aaaaaaaaaaa',
  'https://www.youtube.com/watch?v=aaaaaaaaaaa&list=PLabc&t=10s',
  'https://www.youtube.com/shorts/aaaaaaaaaaa',
  'https://WWW.YOUTUBE.COM/@exemplo',
]
for (const url of accepted) {
  assert.equal(isYouTubeUrl(url), true, `isYouTubeUrl recusou ${url}`)
  assert.equal(safeYouTubeHref(url), url)
}

const refused = [
  'https://www.youtube.com/',
  'https://www.youtube.com',
  'https://www.youtube.com/redirect?q=https%3A%2F%2Fevil.example%2F',
  'https://www.youtube.com/logout',
  'https://www.youtube.com/signin',
  'https://www.youtube.com/feed/channels',
  'https://www.youtube.com/feed/subscriptions',
  'https://www.youtube.com/results?search_query=x',
  'https://www.youtube.com/account',
  'https://www.youtube.com/@',            // handle vazio
  'https://www.youtube.com/channel/',     // id vazio
  'https://www.youtube.com/c/',
  'https://www.youtube.com/user/',
  'https://www.youtube.com/shorts/',
  'https://www.youtube.com/watch',        // sem v=
  'https://www.youtube.com/watch?list=PLabc',
  'https://www.youtube.com/watch?v=',
  'https://www.youtube.com/playlist',     // sem list=
  'https://www.youtube.com/playlist?x=1',
  'https://www.youtube.com/playlist?list=',
  'https://www.youtube.com//redirect?q=x',
  'https://www.youtube.com/channelx/UCabc',
  'https://www.youtube.com/@x/../logout',  // o parser normaliza para /logout
  'https://www.youtube.com/%40x',
]
for (const url of refused) {
  assert.equal(isYouTubeUrl(url), false, `isYouTubeUrl aceitou ${url}`)
  assert.equal(safeYouTubeHref(url), undefined, `safeYouTubeHref aceitou ${url}`)
}

// Uma URL fora da lista derruba só o elemento, como qualquer outra URL ruim.
const base = {
  id: 'org-1', type: 'channel', youtubeId: 'UC1', name: 'Um', thumbnailUrl: '',
  url: 'https://www.youtube.com/@um', folderId: null, tagIds: [], isSubscribed: true, addedAt: 1, lastSyncedAt: 1,
}
const r = sanitizeBackupCollections({
  organizables: [base, { ...base, id: 'org-2', youtubeId: 'UC2', url: 'https://www.youtube.com/redirect?q=x' }],
  folders: [], tags: [], watchHistory: [],
})
assert.ok(r)
assert.deepEqual(r.organizables.map(o => o.id), ['org-1'])
assert.equal(r.dropped.organizables, 1)

// Canal: só as formas de canal (é o que o worker busca e o que o unsubscribe abre).
for (const url of accepted.filter(u => /\/(@|channel\/|c\/|user\/)/i.test(u))) {
  assert.equal(isYouTubeChannelUrl(url), true, `isYouTubeChannelUrl recusou ${url}`)
}
for (const url of ['https://www.youtube.com/watch?v=aaaaaaaaaaa', 'https://www.youtube.com/playlist?list=PLabc',
  'https://www.youtube.com/shorts/aaaaaaaaaaa', ...refused]) {
  assert.equal(isYouTubeChannelUrl(url), false, `isYouTubeChannelUrl aceitou ${url}`)
}

// Retorno do lote: é a página em que o usuário estava, então qualquer caminho,
// mas só no host do YouTube e sem credencial/porta.
for (const url of ['https://www.youtube.com/', 'https://www.youtube.com/feed/channels',
  'https://www.youtube.com/results?search_query=x', 'https://youtube.com/@exemplo']) {
  assert.equal(isYouTubeReturnUrl(url), true, `isYouTubeReturnUrl recusou ${url}`)
}
for (const url of ['http://www.youtube.com/', 'https://evil.example/', 'https://m.youtube.com/',
  'https://user:pw@www.youtube.com/', 'https://www.youtube.com:8443/', 'javascript:alert(1)', '', null, undefined, 42]) {
  assert.equal(isYouTubeReturnUrl(url), false, `isYouTubeReturnUrl aceitou ${JSON.stringify(url)}`)
}

console.log('youtube-url-path: ok')
