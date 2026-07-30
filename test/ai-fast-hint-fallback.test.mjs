import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { completeApiKey } from '../src/background/ai/api-key.ts'

// INVARIANTE: a dica de "não pense" é OTIMISTA, e o servidor que não a conhece
// não pode perder a chamada.
//
// `chat_template_kwargs.enable_thinking` é convenção de vLLM/SGLang/omlx e vale
// muito onde funciona (medido: 106s → 4,8s no mesmo lote, mesmo resultado). Mas
// a API da OpenAI recusa argumento desconhecido com 400. Sem a segunda tentativa,
// ligar a extensão na OpenAI quebraria a categorização inteira.
//
// O fallback é o comportamento anterior INTEIRO — mesma requisição, só sem o
// campo — e não uma versão reduzida.

function serve(handler) {
  const srv = createServer((req, res) => {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => handler(JSON.parse(body || '{}'), res))
  })
  return new Promise(resolve => {
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}

const provider = port => ({
  id: 'p', label: 'fake', kind: 'api-key',
  baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm',
})

const OK = { choices: [{ message: { content: '[{"n":1,"folder":"X"}]' } }] }

// ── servidor estilo OpenAI: 400 no campo desconhecido ────────────────────────

{
  const seen = []
  const { srv, port } = await serve((body, res) => {
    seen.push('chat_template_kwargs' in body)
    if ('chat_template_kwargs' in body) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: { message: 'Unrecognized request argument supplied: chat_template_kwargs' } }))
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(OK))
  })
  const out = await completeApiKey(provider(port), 'oi')
  srv.close()
  assert.deepEqual(seen, [true, false], 'esperava tentar COM a dica e repetir SEM ela')
  assert.equal(out, '[{"n":1,"folder":"X"}]', 'o fallback tem de devolver o conteúdo, não vazio')
}

// ── servidor que aceita a dica: uma chamada só ───────────────────────────────

{
  let calls = 0
  const { srv, port } = await serve((body, res) => {
    calls++
    assert.equal(body.chat_template_kwargs?.enable_thinking, false, 'a dica não foi enviada')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(OK))
  })
  await completeApiKey(provider(port), 'oi')
  srv.close()
  assert.equal(calls, 1, 'servidor que aceita a dica não pode ser chamado duas vezes')
}

// ── erro que não é 400 sobe com o motivo, sem retentativa ────────────────────

{
  let calls = 0
  const { srv, port } = await serve((_b, res) => {
    calls++
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } }))
  })
  await assert.rejects(
    () => completeApiKey(provider(port), 'oi'),
    /401.*Incorrect API key provided/,
    'o motivo do servidor tem de chegar ao usuário — "HTTP 401" sozinho não é diagnóstico',
  )
  srv.close()
  assert.equal(calls, 1, '401 não melhora numa retentativa; repetir só gasta tempo')
}

console.log('✓ ai-fast-hint-fallback: 7 asserções passaram')
