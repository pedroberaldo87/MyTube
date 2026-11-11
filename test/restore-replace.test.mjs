import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// INVARIANTE: "Substituir" do restore troca primeiro o histórico (IndexedDB,
// transação atômica) e só então grava o mytube_state. Se o passo do histórico
// falhar, as pastas/tags do usuário continuam as dele. E um backup sem
// `watchHistory`, ou cujo histórico não tem nenhuma entrada válida, NÃO apaga o
// histórico atual; só `watchHistory: []` explícito esvazia.

const { planHistoryReplace, normalizeHistoryField, restoreReplace } = await import('../src/shared/restore.ts')
const { isWatchMessage, handleWatchMessage } = await import('../src/background/watch-history.ts')

const e = (videoId) => ({ videoId, channelId: 'UCexemplo', title: videoId, watchedAt: 1 })

// ── planHistoryReplace ──────────────────────────────────────────────────────
assert.equal(planHistoryReplace(undefined, []), null, 'chave ausente: histórico intacto')
assert.equal(planHistoryReplace('x', []), null, 'não é lista: histórico intacto')
assert.equal(planHistoryReplace([null, 7], []), null, 'nada válido num histórico não vazio: intacto')
assert.deepEqual(planHistoryReplace([], []), [], 'lista vazia EXPLÍCITA esvazia o histórico')
assert.deepEqual(planHistoryReplace([e('aaaaaaaaaaa'), null], [e('aaaaaaaaaaa')]), [e('aaaaaaaaaaa')])

// ── normalizeHistoryField: ausente vira [] só para o validador passar ───────
assert.deepEqual(normalizeHistoryField(undefined), [])
assert.equal(normalizeHistoryField('x'), 'x', 'valor errado segue para o validador rejeitar o arquivo')
assert.deepEqual(normalizeHistoryField([]), [])

// ── restoreReplace: histórico PRIMEIRO, estado depois ───────────────────────
{
  const calls = []
  await restoreReplace([e('aaaaaaaaaaa')], async (h) => { calls.push(['history', h.length]) }, async () => { calls.push(['state']) })
  assert.deepEqual(calls, [['history', 1], ['state']])
}

// falha no histórico: o estado NÃO é gravado
{
  const calls = []
  await assert.rejects(
    restoreReplace([e('aaaaaaaaaaa')], async () => { throw new Error('idb') }, async () => { calls.push('state') }),
    /idb/,
  )
  assert.deepEqual(calls, [], 'mytube_state não pode ser sobrescrito se o histórico falhou')
}

// plano nulo: histórico não é tocado, estado é gravado
{
  const calls = []
  await restoreReplace(null, async () => { calls.push('history') }, async () => { calls.push('state') })
  assert.deepEqual(calls, ['state'])
}

// ── WATCH_CLEAR não existe mais (sem chamador, destrutivo) ──────────────────
assert.equal(isWatchMessage({ type: 'WATCH_CLEAR' }), false)
assert.equal(await handleWatchMessage({ type: 'WATCH_CLEAR' }, {}), undefined)
for (const f of ['src/shared/types.ts', 'src/background/watch-history.ts', 'src/shared/db.ts']) {
  const src = await readFile(new URL(`../${f}`, import.meta.url), 'utf8')
  assert.doesNotMatch(src, /WATCH_CLEAR|clearWatchHistory/, `${f} ainda menciona WATCH_CLEAR/clearWatchHistory`)
}

// ── os dois importadores usam o mesmo caminho (histórico primeiro) ──────────
for (const f of ['src/content/sidebar/components/ExportImport.tsx', 'src/dashboard/pages/Settings.tsx']) {
  const src = await readFile(new URL(`../${f}`, import.meta.url), 'utf8')
  assert.match(src, /restoreReplace\(/, `${f} deve usar restoreReplace`)
  assert.match(src, /planHistoryReplace\(/, `${f} deve usar planHistoryReplace`)
}

console.log('ok restore-replace')
