import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// INVARIANTE: mesmo que uma URL ruim chegue ao storage por outro caminho, os
// pontos onde ela é USADA recusam tudo que não seja https://(www.)youtube.com:
//   - fetchChannelVideos (service worker) não faz GET em host de terceiros;
//   - triggerUnsubscribe / triggerBatchUnsubscribe não navegam a aba;
//   - âncoras da sidebar e do dashboard não recebem href de terceiros.

// ── fetchChannelVideos ──────────────────────────────────────────────────────

const chamadas = []
globalThis.fetch = async (url) => { chamadas.push(String(url)); return { ok: false, status: 404, text: async () => '' } }

const { fetchChannelVideos } = await import('../src/background/channel-scraper.ts')

for (const [i, url] of ['https://evil.example/', 'http://127.0.0.1:8080/x?', 'javascript:alert(1)',
  'https://www.youtube.com.evil.example/@x', 'https://www.youtube.com@evil.example/', '', 'not a url'].entries()) {
  const r = await fetchChannelVideos(url, `UCbad${i}`, 'x')
  assert.deepEqual(r, [])
  assert.deepEqual(chamadas, [], `fetch foi chamado para ${JSON.stringify(url)}: ${chamadas}`)
}
await fetchChannelVideos('https://www.youtube.com/@exemplo/', 'UCgood', 'Exemplo')
assert.deepEqual(chamadas, ['https://www.youtube.com/@exemplo/videos'], 'canal legítimo continua sendo buscado')

// ── unsubscribe.ts ──────────────────────────────────────────────────────────

const memoria = new Map()
globalThis.sessionStorage = {
  getItem: k => memoria.get(k) ?? null,
  setItem: (k, v) => { memoria.set(k, String(v)) },
  removeItem: k => { memoria.delete(k) },
}
const INICIO = 'https://www.youtube.com/feed/channels'
globalThis.window = { location: { href: INICIO, pathname: '/feed/channels' } }
// readyState 'loading' + listener mudo: o módulo não agenda o checkPending de 1,5 s.
globalThis.document = { readyState: 'loading', addEventListener() {} }

const { triggerUnsubscribe, triggerBatchUnsubscribe } = await import('../src/content/unsubscribe.ts')

function limpa() { memoria.clear(); window.location.href = INICIO; window.location.pathname = '/feed/channels' }

for (const url of ['javascript:alert(1)', 'https://evil.example/', 'http://127.0.0.1:8080/x?',
  'https://www.youtube.com.evil.example/', 'data:text/html,x', '', 'nem url']) {
  limpa()
  assert.doesNotThrow(() => triggerUnsubscribe(url), `triggerUnsubscribe(${JSON.stringify(url)}) lançou`)
  assert.equal(window.location.href, INICIO, `navegou para ${JSON.stringify(url)}`)
  assert.equal(memoria.size, 0, 'não pode deixar estado pendente para uma URL recusada')
}

limpa()
triggerUnsubscribe('https://www.youtube.com/@exemplo')
assert.equal(window.location.href, 'https://www.youtube.com/@exemplo', 'canal legítimo continua navegando')
assert.ok(memoria.has('mytube-pending-unsub'))

limpa()
triggerBatchUnsubscribe(['https://evil.example/', 'javascript:alert(1)'])
assert.equal(window.location.href, INICIO)
assert.equal(memoria.size, 0)

limpa()
triggerBatchUnsubscribe(['https://evil.example/', 'https://www.youtube.com/@a', 'javascript:alert(1)', 'https://youtube.com/@b'])
assert.equal(window.location.href, 'https://www.youtube.com/@a', 'o lote pula as recusadas e começa pela primeira boa')
const lote = JSON.parse(memoria.get('mytube-unsub-batch'))
assert.deepEqual(lote.urls, ['https://www.youtube.com/@a', 'https://youtube.com/@b'])
assert.equal(lote.total, 2)

// ── âncoras: nenhum href cru de organizable ─────────────────────────────────

for (const f of ['src/content/sidebar/components/FolderTree.tsx', 'src/content/sidebar/components/LibraryItem.tsx',
  'src/dashboard/pages/Channels.tsx', 'src/dashboard/pages/Playlists.tsx']) {
  const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
  assert.doesNotMatch(src, /href=\{(item|channel|playlist)\.url\}/, `${f} ainda liga item.url direto no href`)
  assert.match(src, /safeYouTubeHref\(/, `${f} não usa safeYouTubeHref`)
}

console.log('import-sinks: ok')
