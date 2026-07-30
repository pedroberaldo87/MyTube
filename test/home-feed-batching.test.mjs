import assert from 'node:assert/strict'

// INVARIANTE: os feeds buscam canais em LOTES, nunca um a um.
// Medido na revisão: 324 ms e 1,1 MB de HTML por canal, o que punha a Home em
// ~10 s com o estado real (810 organizables, 44 pastas). O polling já fazia lotes
// de 3 com Promise.all; os dois caminhos de feed não. Este teste mede a
// CONCORRÊNCIA real, sem rede — leitura de código não prova paralelismo.

globalThis.chrome = {
  storage: { local: { get: async () => ({}), set: async () => {} } },
  alarms: { create: () => {} },
  action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
}
globalThis.crypto ??= (await import('node:crypto')).webcrypto

const { fetchChannelsBatched } = await import('../src/background/channel-poller.ts')

const canais = n => Array.from({ length: n }, (_, i) => ({
  youtubeId: `UC${i}`, url: `https://youtube.com/@c${i}/videos`, name: `c${i}`,
}))

/** Fetcher falso que registra quantas chamadas ficam em voo ao mesmo tempo. */
function espiao(atraso = 5) {
  let emVoo = 0
  const s = { pico: 0, chamadas: [] }
  const fetcher = async (url, youtubeId, name) => {
    emVoo++
    s.pico = Math.max(s.pico, emVoo)
    s.chamadas.push(youtubeId)
    await new Promise(r => setTimeout(r, atraso))
    emVoo--
    return [{ videoId: `v-${youtubeId}`, title: name, channelId: youtubeId, channelName: name,
              thumbnailUrl: '', publishedAt: 1 }]
  }
  return { s, fetcher }
}

// ── 1. roda em paralelo, e o lote é 3 ────────────────────────────────────────
{
  const { s, fetcher } = espiao()
  const out = await fetchChannelsBatched(canais(9), fetcher)
  assert.equal(s.chamadas.length, 9, 'não buscou todos os canais')
  assert.equal(s.pico, 3, `o lote não é 3 — pico de concorrência foi ${s.pico} (1 = sequencial, o defeito)`)
  assert.equal(out.size, 9, 'o mapa de resultado perdeu canal')
  assert.equal(out.get('UC4')[0].videoId, 'v-UC4', 'resultado foi associado ao canal errado')
}

// ── 2. lote incompleto no fim não quebra ─────────────────────────────────────
{
  const { s, fetcher } = espiao()
  const out = await fetchChannelsBatched(canais(7), fetcher)
  assert.equal(s.chamadas.length, 7)
  assert.equal(out.size, 7)
  assert.equal(s.pico, 3)
}

// ── 3. menos canais que o lote: concorrência é o que houver ──────────────────
{
  const { s, fetcher } = espiao()
  await fetchChannelsBatched(canais(2), fetcher)
  assert.equal(s.pico, 2, 'com 2 canais o pico devia ser 2')
}

// ── 4. lista vazia não chama ninguém ─────────────────────────────────────────
{
  const { s, fetcher } = espiao()
  const out = await fetchChannelsBatched([], fetcher)
  assert.equal(s.chamadas.length, 0)
  assert.equal(out.size, 0)
}

// ── 5. canal que falha (lista vazia) não derruba o lote nem some do mapa ─────
{
  let i = 0
  const fetcher = async (url, youtubeId) => {
    i++
    if (i === 2) return [] // o scraper devolve [] quando falha
    return [{ videoId: `v-${youtubeId}`, title: '', channelId: youtubeId, channelName: '',
              thumbnailUrl: '', publishedAt: 1 }]
  }
  const out = await fetchChannelsBatched(canais(4), fetcher)
  assert.equal(out.size, 4, 'canal que falhou desapareceu do mapa')
  assert.equal([...out.values()].filter(v => v.length === 0).length, 1, 'a falha não foi preservada como lista vazia')
}

console.log('✓ home-feed-batching: 12 asserções passaram')
