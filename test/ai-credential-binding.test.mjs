import assert from 'node:assert/strict'
import { bootWorker, EXT_SENDER, CONTENT_SENDER } from './helpers/worker-harness.mjs'

// INVARIANT: a stored credential is bound to the destination it was entered
// for. The worker, not the sidebar form, enforces it.
//
//  1. AI_SAVE_PROVIDER for an existing id whose baseUrl changes drops the stored
//     credential, unless the same save carries a new one. The old key is never
//     sent to the new URL (the re-point attack: a save with the id of an
//     existing provider, an attacker URL and no credential).
//  2. A model-only / label-only save (same baseUrl) still preserves the key.
//  3. openai-oauth providers are pinned to OPENAI_OAUTH_BASE_URL and their kind
//     cannot be changed by a save; tokens are never accepted from a message.
//  4. A save that carries a credential is accepted only from an extension page,
//     never from a content script on youtube.com.
//  5. Cleartext http:// to a public host is refused; loopback/private stays OK.
//  6. A save never leaks the credential back in its response.

const LEGACY_KEY = 'mytube-ai-providers'
const OLD_KEY = 'KEY-SECRET-OLD-1111'
const NEW_KEY = 'KEY-SECRET-NEW-2222'
const OAUTH_BASE = 'https://chatgpt.com/backend-api/codex'

const w = await bootWorker({
  storage: {
    [LEGACY_KEY]: {
      providers: [
        { id: 'p1', label: 'Gateway', kind: 'api-key', baseUrl: 'https://llm.example.com/v1', model: 'model-a', apiKey: OLD_KEY },
        {
          id: 'po', label: 'ChatGPT', kind: 'openai-oauth', baseUrl: OAUTH_BASE, model: null,
          tokens: { accessToken: 'ACCESS-SECRET-9999', refreshToken: 'REFRESH-SECRET-9999', obtainedAt: Date.now() },
        },
      ],
      activeProviderId: 'p1',
    },
  },
})

const listed = async () => (await w.send({ type: 'AI_LIST_PROVIDERS' })).providers
const get = async id => (await listed()).find(p => p.id === id)
const save = (payload, sender = EXT_SENDER) => w.send({ type: 'AI_SAVE_PROVIDER', payload }, sender)
const base = { id: 'p1', label: 'Gateway', kind: 'api-key', baseUrl: 'https://llm.example.com/v1', model: 'model-a' }

// ── 2. same baseUrl keeps the key ────────────────────────────────────────────
let r = await save({ ...base, model: 'model-b' }, CONTENT_SENDER)
assert.equal(r.ok, true, 'a model-only save from the sidebar (no credential) was refused')
assert.equal((await get('p1')).hasCredential, true, 'model-only save dropped the credential')
await w.send({ type: 'AI_TEST_PROVIDER', payload: { id: 'p1' } })
assert.equal(w.fetches.at(-1).authorization, `Bearer ${OLD_KEY}`, 'model-only save lost the stored key')

r = await save({ ...base, label: 'Renamed' }, EXT_SENDER)
assert.equal((await get('p1')).hasCredential, true, 'label-only save from the key page dropped the credential')

// ── 1. baseUrl change drops the key ──────────────────────────────────────────
const before = w.fetches.length
r = await save({ ...base, baseUrl: 'https://attacker.example.net/v1' }, CONTENT_SENDER)
assert.equal((await get('p1')).hasCredential, false, 'credential survived a baseUrl change: it would be sent to the new URL')
assert.equal((await get('p1')).model, null, 'model from the old endpoint survived a baseUrl change')
await w.send({ type: 'AI_TEST_PROVIDER', payload: { id: 'p1' } })
await w.send({ type: 'AI_LIST_MODELS', payload: { id: 'p1' } })
for (const f of w.fetches.slice(before)) {
  assert.equal(f.authorization, null, `old key sent to ${f.url}`)
}

// a change of baseUrl together with a NEW key is a legitimate re-point
r = await save({ ...base, baseUrl: 'https://llm2.example.com/v1', apiKey: NEW_KEY })
assert.equal(r.ok, true)
assert.equal((await get('p1')).hasCredential, true)
await w.send({ type: 'AI_TEST_PROVIDER', payload: { id: 'p1' } })
assert.equal(w.fetches.at(-1).url, 'https://llm2.example.com/v1/models')
assert.equal(w.fetches.at(-1).authorization, `Bearer ${NEW_KEY}`)

// trailing-slash / case variants of the same endpoint are NOT a change
r = await save({ ...base, baseUrl: 'https://LLM2.example.com/v1' })
assert.equal((await get('p1')).hasCredential, true, 'a cosmetic URL variant was treated as a different destination')

// ── 3. openai-oauth is pinned ────────────────────────────────────────────────
r = await save({ id: 'po', label: 'ChatGPT', kind: 'openai-oauth', baseUrl: 'https://attacker.example.net/codex', model: null }, CONTENT_SENDER)
const po = await get('po')
assert.equal(po.baseUrl, OAUTH_BASE, 'openai-oauth baseUrl was re-pointed by a message')
assert.equal(po.hasCredential, true, 'pinning the oauth baseUrl must not drop its tokens')

r = await save({ id: 'po', label: 'ChatGPT', kind: 'api-key', baseUrl: 'https://attacker.example.net/v1', model: null }, CONTENT_SENDER)
assert.equal((await get('po')).kind, 'openai-oauth', 'kind of an existing provider was changed by a message')
assert.equal((await get('po')).baseUrl, OAUTH_BASE)

const fetchesBefore = w.fetches.length
await w.send({ type: 'AI_LIST_MODELS', payload: { id: 'po' } })
for (const f of w.fetches.slice(fetchesBefore)) {
  assert.ok(f.url.startsWith(OAUTH_BASE) || f.url.includes('auth.openai.com'), `oauth request went to ${f.url}`)
}

r = await save({ id: 'po-new', label: 'x', kind: 'openai-oauth', baseUrl: OAUTH_BASE, model: null }, EXT_SENDER)
assert.equal(r.ok, false, 'a save created an openai-oauth provider: only the device flow may create one')
assert.equal(await get('po-new'), undefined)

// tokens in a message are ignored
r = await save({ ...base, id: 'p-tok', tokens: { accessToken: 'INJECTED', refreshToken: 'INJECTED', obtainedAt: 1 } })
assert.equal((await get('p-tok'))?.hasCredential ?? false, false, 'tokens from a message were stored')

// ── 4. credential-bearing saves only from extension pages ────────────────────
r = await save({ ...base, id: 'p-cs', baseUrl: 'https://cs.example.com/v1', apiKey: 'KEY-SECRET-CS-3333' }, CONTENT_SENDER)
assert.equal(r.ok, false, 'a content script was allowed to submit an API key')
assert.equal(await get('p-cs'), undefined, 'provider from a rejected save was created')
r = await save({ ...base, id: 'p-ext', baseUrl: 'https://ext.example.com/v1', apiKey: 'KEY-SECRET-EXT-4444' }, EXT_SENDER)
assert.equal(r.ok, true)
assert.equal((await get('p-ext')).hasCredential, true)
// a sender with no extension identity at all is not an extension page either
r = await save({ ...base, id: 'p-anon', baseUrl: 'https://anon.example.com/v1', apiKey: 'KEY-SECRET-ANON-5555' }, {})
assert.equal(r.ok, false)

// ── 5. cleartext to a public host is refused ─────────────────────────────────
r = await save({ ...base, id: 'p-http', baseUrl: 'http://public.example.com/v1', apiKey: 'KEY-SECRET-HTTP-6666' })
assert.equal(r.ok, false, 'http:// to a public host was accepted')
assert.equal(r.error, 'insecure-http')
assert.equal(await get('p-http'), undefined)
for (const url of ['http://localhost:11434/v1', 'http://192.168.1.5:8080/v1', 'http://100.100.100.100:8000/v1', 'https://public.example.com/v1']) {
  r = await save({ ...base, id: `p-${url}`, baseUrl: url })
  assert.equal(r.ok, true, `${url} must stay accepted: ${r.error}`)
}
r = await save({ ...base, id: 'p-bad', baseUrl: 'not a url' })
assert.equal(r.ok, false)
assert.equal(r.error, 'invalid-url')

// ── 6. nothing leaks in a response ───────────────────────────────────────────
const everything = JSON.stringify([await listed(), r])
for (const s of [OLD_KEY, NEW_KEY, 'ACCESS-SECRET-9999', 'REFRESH-SECRET-9999', 'KEY-SECRET-EXT-4444']) {
  assert.equal(everything.includes(s), false, `credential leaked in a response: ${s}`)
}
assert.equal(JSON.stringify(w.store).includes('SECRET'), false, 'credential written to chrome.storage.local')

console.log('✓ ai-credential-binding: baseUrl binding, oauth pin, sender check, http refusal, no leak')
