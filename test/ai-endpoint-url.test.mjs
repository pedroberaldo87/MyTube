import assert from 'node:assert/strict'
import { normalizeEndpointUrl, originFromUrl, ensureHostPermission } from '../src/shared/ai/host-permission.ts'

// ── 1. esquema inferido: host privado vira http ──────────────────────────────
// INVARIANTE: o usuário escreve o endereço como ele o conhece; quem decide o
// esquema é o tipo de host, não o usuário.
assert.equal(normalizeEndpointUrl('100.100.100.100:8000/v1'), 'http://100.100.100.100:8000/v1', 'IP do Tailscale (100.64/10) tem de virar http')
assert.equal(normalizeEndpointUrl('192.168.0.9:1234'), 'http://192.168.0.9:1234/')
assert.equal(normalizeEndpointUrl('10.0.0.5/v1'), 'http://10.0.0.5/v1')
assert.equal(normalizeEndpointUrl('172.20.1.1:8080'), 'http://172.20.1.1:8080/')
assert.equal(normalizeEndpointUrl('127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1')
assert.equal(normalizeEndpointUrl('localhost:11434'), 'http://localhost:11434/')

// ── 2. esquema inferido: host público vira https ─────────────────────────────
assert.equal(normalizeEndpointUrl('api.exemplo.com/v1'), 'https://api.exemplo.com/v1')
assert.equal(normalizeEndpointUrl('172.32.1.1:8080'), 'https://172.32.1.1:8080/', '172.32 está FORA da faixa privada 172.16/12')

// ── 3. esquema explícito é respeitado ────────────────────────────────────────
assert.equal(normalizeEndpointUrl('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1')
assert.equal(normalizeEndpointUrl('http://api.exemplo.com/v1'), 'http://api.exemplo.com/v1')
assert.equal(normalizeEndpointUrl('  https://openrouter.ai/api/v1  '), 'https://openrouter.ai/api/v1', 'espaço em volta não invalida')

// ── 4. entrada inválida é inválida, e não se disfarça de outra coisa ─────────
assert.equal(normalizeEndpointUrl(''), null)
assert.equal(normalizeEndpointUrl('   '), null)
assert.equal(normalizeEndpointUrl('ftp://x/y'), null, 'esquema não-http tem de ser rejeitado')
assert.equal(normalizeEndpointUrl('http://'), null)

// ── 5. origin mantém a porta (o Chrome aceitou porta no diálogo real) ────────
assert.equal(originFromUrl('http://100.100.100.100:8000/v1'), 'http://100.100.100.100:8000/*')
assert.equal(originFromUrl('https://openrouter.ai/api/v1'), 'https://openrouter.ai/*')

// ── 6. os quatro motivos são distinguíveis ───────────────────────────────────
// INVARIANTE: a tela nunca diz "permissão negada" quando ninguém foi perguntado.
function mockChrome(behavior) {
  globalThis.chrome = {
    permissions: {
      request() {
        if (behavior === 'throw') throw new Error('Only permissions specified in the manifest may be requested.')
        return Promise.resolve(behavior === 'grant')
      },
    },
  }
}

mockChrome('grant')
assert.equal(await ensureHostPermission('100.100.100.100:8000/v1'), 'granted')

mockChrome('deny')
assert.equal(await ensureHostPermission('100.100.100.100:8000/v1'), 'denied', 'usuário recusando tem de ser denied')

mockChrome('throw')
assert.equal(await ensureHostPermission('100.100.100.100:8000/v1'), 'cannot-request', 'exceção do Chrome tem de ser cannot-request, não denied')

let chamou = false
globalThis.chrome = { permissions: { request() { chamou = true; return Promise.resolve(true) } } }
assert.equal(await ensureHostPermission('ftp://x/y'), 'invalid-url')
assert.equal(chamou, false, 'URL inválida não pode chegar a pedir permissão')

// ── 7. lixo digitado NAO vira endpoint ───────────────────────────────────────
// INVARIANTE: a forma do host e checada no texto CRU. O parser de URL do CHROME
// aceita `nao é uma url` e devolve `https://xn--nao%20%20uma%20url-gwb/`; o do
// Node lanca. Delegar a validacao ao parser deixou a tela salvar lixo em silencio
// enquanto este teste, rodando em Node, ficava verde.
for (const lixo of ['nao é uma url', 'isso aqui não é url', 'a b c', 'meu servidor', '...', 'http://', '-.-', 'a..b']) {
  assert.equal(normalizeEndpointUrl(lixo), null, `aceitou lixo como endpoint: ${JSON.stringify(lixo)}`)
}

// e o que E host continua passando
assert.equal(normalizeEndpointUrl('100.100.100.100:8000/v1'), 'http://100.100.100.100:8000/v1')
assert.equal(normalizeEndpointUrl('localhost:11434/v1'), 'http://localhost:11434/v1')
assert.equal(normalizeEndpointUrl('api.exemplo.com/v1'), 'https://api.exemplo.com/v1')
assert.equal(normalizeEndpointUrl('my-server.local:8080'), 'http://my-server.local:8080/')

console.log('✓ ai-endpoint-url: 34 asserções passaram')
