import assert from 'node:assert/strict'
import { normalizeEndpointUrl, endpointProblem } from '../src/shared/ai/host-permission.ts'

// INVARIANT: an API key is never sent in cleartext across a network the user
// does not control. An explicit http:// URL is accepted only for loopback and
// private hosts (the same isPrivateHost that picks the scheme when none is
// typed); for any other host it is refused, with a reason distinct from garbage.

for (const url of [
  'http://public.example/v1',
  'http://api.example.com/v1',
  'http://172.32.1.1:8080/v1',          // just outside 172.16/12
  'http://127.0.0.1.example.com/v1',    // looks loopback, is a public name
  'HTTP://Public.Example/v1',
]) {
  assert.equal(normalizeEndpointUrl(url), null, `accepted cleartext to a public host: ${url}`)
  assert.equal(endpointProblem(url), 'insecure-http', `wrong problem for ${url}`)
}

for (const url of [
  'http://localhost:11434/v1',
  'http://192.168.1.5:8080/v1',
  'http://10.0.0.5/v1',
  'http://172.20.1.1:8080/v1',
  'http://100.100.100.100:8000/v1',
  'http://127.0.0.1:11434/v1',
  'http://my-server.local:8080/v1',
]) {
  assert.notEqual(normalizeEndpointUrl(url), null, `refused a private/loopback http endpoint: ${url}`)
  assert.equal(endpointProblem(url), null, `flagged ${url}`)
}

// https and scheme-less input are unaffected
assert.equal(normalizeEndpointUrl('https://api.example.com/v1'), 'https://api.example.com/v1')
assert.equal(normalizeEndpointUrl('api.example.com/v1'), 'https://api.example.com/v1')
assert.equal(normalizeEndpointUrl('localhost:11434'), 'http://localhost:11434/')
assert.equal(endpointProblem('api.example.com/v1'), null)

// garbage stays "invalid-url", not "insecure-http"
assert.equal(endpointProblem('not a url'), 'invalid-url')
assert.equal(endpointProblem('ftp://x/y'), 'invalid-url')
assert.equal(endpointProblem(''), 'invalid-url')

console.log('✓ ai-endpoint-cleartext: public http refused, private/loopback http and https accepted')
