import assert from 'node:assert/strict'

// INVARIANTE: exportar, importar (mesclar/substituir) e limpar o histórico de
// exibição são feitos pelo service worker, com o validador por elemento de
// shared/backup-validate.ts, sobre o banco da extensão.
//
// O handler recebe o "store" por parâmetro; aqui ele é um banco em memória com
// a mesma semântica do db.ts (importar só acrescenta, substituir troca tudo).

const { handleWatchMessage } = await import('../src/background/watch-history.ts')

function memoryStore(inicial = []) {
  const rows = [...inicial]
  return {
    rows,
    async exportWatchHistory() { return rows.map(r => ({ ...r })) },
    async importWatchHistory(entries) { rows.push(...entries) },
    async replaceWatchHistory(entries) { rows.splice(0, rows.length, ...entries) },
    async clearWatchHistory() { rows.splice(0, rows.length) },
  }
}

const e = (videoId, watchedAt) => ({ videoId, channelId: 'UCexemplo', title: `Vídeo ${videoId}`, watchedAt })

// ── WATCH_EXPORT devolve o que o worker tem ─────────────────────────────────
{
  const store = memoryStore([e('aaaaaaaaaaa', 1), e('bbbbbbbbbbb', 2)])
  const r = await handleWatchMessage({ type: 'WATCH_EXPORT' }, store)
  assert.deepEqual(r.map(x => x.videoId), ['aaaaaaaaaaa', 'bbbbbbbbbbb'])
}

// ── WATCH_IMPORT merge: acrescenta, valida cada elemento ────────────────────
{
  const store = memoryStore([e('aaaaaaaaaaa', 1)])
  const r = await handleWatchMessage(
    { type: 'WATCH_IMPORT', payload: { mode: 'merge', entries: [e('bbbbbbbbbbb', 2), null, 7, { videoId: 5 }, e('ccccccccccc', 3)] } },
    store,
  )
  assert.deepEqual(r, { ok: true, imported: 2, dropped: 3 })
  assert.deepEqual(store.rows.map(x => x.videoId), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'])
}

// ── WATCH_IMPORT replace: o histórico anterior some ─────────────────────────
{
  const store = memoryStore([e('aaaaaaaaaaa', 1), e('bbbbbbbbbbb', 2)])
  const r = await handleWatchMessage(
    { type: 'WATCH_IMPORT', payload: { mode: 'replace', entries: [e('ccccccccccc', 3)] } },
    store,
  )
  assert.deepEqual(r, { ok: true, imported: 1, dropped: 0 })
  assert.deepEqual(store.rows.map(x => x.videoId), ['ccccccccccc'])
}

// ── replace com lista inválida NÃO apaga o histórico existente ──────────────
for (const entries of [undefined, null, 'x', { length: 1 }]) {
  const store = memoryStore([e('aaaaaaaaaaa', 1)])
  const r = await handleWatchMessage({ type: 'WATCH_IMPORT', payload: { mode: 'replace', entries } }, store)
  assert.equal(r.ok, false, `entries=${JSON.stringify(entries)} deve ser recusado`)
  assert.equal(store.rows.length, 1, 'histórico intacto')
}

// ── modo desconhecido é recusado; payload ausente também ────────────────────
for (const payload of [undefined, null, { mode: 'wipe', entries: [] }, { entries: [] }]) {
  const store = memoryStore([e('aaaaaaaaaaa', 1)])
  const r = await handleWatchMessage({ type: 'WATCH_IMPORT', payload }, store)
  assert.equal(r.ok, false)
  assert.equal(store.rows.length, 1)
}

// ── WATCH_CLEAR ─────────────────────────────────────────────────────────────
{
  const store = memoryStore([e('aaaaaaaaaaa', 1), e('bbbbbbbbbbb', 2)])
  assert.deepEqual(await handleWatchMessage({ type: 'WATCH_CLEAR' }, store), { ok: true })
  assert.equal(store.rows.length, 0)
}

// ── tipo que não é do histórico: não é tratado aqui ─────────────────────────
assert.equal(await handleWatchMessage({ type: 'GET_STATE' }, memoryStore()), undefined)

// ── dashboard: "Substituir" também troca o histórico (antes só acrescentava) ──
{
  const { readFile } = await import('node:fs/promises')
  const settings = await readFile(new URL('../src/dashboard/pages/Settings.tsx', import.meta.url), 'utf8')
  assert.match(settings, /importMode === 'replace'\)\s*await replaceWatchHistory\(/, 'Replace do dashboard deve chamar replaceWatchHistory')
}

console.log('ok watch-history-messages')
