import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseResponsesStream } from '../src/background/ai/openai-oauth.ts'

// INVARIANTE: o texto do Codex sai dos DELTAS.
//
// A fixture não foi escrita à mão: é a captura literal de uma resposta real de
// https://chatgpt.com/backend-api/codex/responses. Ela existe porque a versão
// anterior deste adaptador foi escrita a partir da forma que a API "deveria" ter
// — `res.json()` num corpo que é SSE — e falhava sempre.
//
// O que só a captura revela, e que derruba a implementação plausível:
//
//   1. O backend EXIGE stream:true e store:false, e recusa em texto claro
//      ({"detail":"Stream must be set to true"}).
//   2. A resposta vem com `content-type` NULO — `res.json()` estoura.
//   3. `response.completed` chega com `output: []` VAZIO. Quem parseasse só o
//      evento final, que é a leitura natural da doc da Responses API, receberia
//      string vazia EM SILÊNCIO: sem exceção, sem HTTP de erro, só uma
//      categorização que não devolve nada.

const RAW = readFileSync(new URL('./fixtures/codex-responses-stream.sse', import.meta.url), 'utf8')

// ── o caminho real: 12 deltas de 1 a 7 chars viram um JSON inteiro ───────────

assert.equal(
  parseResponsesStream(RAW),
  '[{"n":1,"folder":"Programação"}]',
  'os deltas não foram concatenados na ordem — é assim que o texto chega, picado',
)

// a captura de fato tem o completed vazio que justifica a regra acima
const completed = RAW.split('\n\n').find(b => b.includes('"type":"response.completed"'))
assert.ok(completed, 'a fixture perdeu o evento response.completed')
assert.match(
  completed, /"output":\s*\[\]/,
  'a fixture não reproduz mais o completed VAZIO — se o backend mudou, o motivo ' +
  'de preferir os deltas mudou junto e esta decisão precisa ser revista',
)

// ── rede: sem deltas, o texto sai do completed ───────────────────────────────

const soCompleted = [
  'event: response.completed',
  'data: ' + JSON.stringify({
    type: 'response.completed',
    response: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'OI' }] }] },
  }),
].join('\n') + '\n\n'
assert.equal(parseResponsesStream(soCompleted), 'OI', 'a rede do completed não funciona')

// ── lixo não vira exceção nem texto ──────────────────────────────────────────

assert.equal(parseResponsesStream(''), '')
assert.equal(parseResponsesStream('data: [DONE]\n\n'), '')
assert.equal(parseResponsesStream('data: {isso nao e json}\n\n'), '', 'payload inválido derrubou o parser')
assert.equal(parseResponsesStream('event: ping\n\n'), '', 'evento sem data derrubou o parser')

// `data:` de múltiplas linhas é parte do SSE e precisa ser reunido antes do parse
const multi = 'event: x\ndata: {"type":"response.output_text.delta",\ndata: "delta":"AB"}\n\n'
assert.equal(parseResponsesStream(multi), 'AB', 'data: em várias linhas não foi reunido')

console.log('✓ ai-codex-stream: 9 asserções passaram sobre um fluxo capturado de verdade')
