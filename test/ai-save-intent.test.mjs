import assert from 'node:assert/strict'
import { bootWorker, EXT_SENDER, CONTENT_SENDER } from './helpers/worker-harness.mjs'

// INVARIANT: a save never creates a provider by accident.
//
// The key window checks that the provider it edits still exists only when it
// LOADS. If the provider is removed in the sidebar while the window is open, Save
// used to send a dead id and the worker accepted it as a brand-new api-key
// provider. Now a save for an unknown id is rejected unless the sender says it is
// an explicit create (`intent: 'create'`, which only the Add flow sends).

const w = await bootWorker({})
const send = (payload, sender = EXT_SENDER) => w.send({ type: 'AI_SAVE_PROVIDER', payload }, sender)
const listed = async () => (await w.send({ type: 'AI_LIST_PROVIDERS' })).providers
const base = { id: 'p1', label: 'Gateway', kind: 'api-key', baseUrl: 'https://llm.example.com/v1' }
const KEY = 'KEY-SECRET-INTENT-1111'

// explicit create works
let r = await send({ ...base, apiKey: KEY, intent: 'create' })
assert.equal(r.ok, true, `an explicit create was refused: ${r.error}`)
assert.equal((await listed()).length, 1)
assert.equal('intent' in (await listed())[0], false, 'the intent leaked into the stored provider')

// edit of an existing id works with or without intent
r = await send({ ...base, label: 'Renamed' })
assert.equal(r.ok, true, 'an edit of an existing provider was refused')
assert.equal((await listed())[0].label, 'Renamed')

// the provider is removed meanwhile; the key window (still open) saves
await w.send({ type: 'AI_DELETE_PROVIDER', payload: { id: 'p1' } })
assert.equal((await listed()).length, 0)
r = await send({ ...base, apiKey: KEY })
assert.equal(r.ok, false, 'a save for a removed provider re-created it')
assert.equal(r.error, 'provider-not-found')
assert.equal((await listed()).length, 0, 'the removed provider came back')

// the same holds for a keyless save from the sidebar (model picker after a removal)
r = await send({ ...base, model: 'model-a' }, CONTENT_SENDER)
assert.equal(r.ok, false, 'a model-picker save for a removed provider re-created it')
assert.equal((await listed()).length, 0)

console.log('✓ ai-save-intent: a save for an unknown id is rejected unless it is an explicit create')
