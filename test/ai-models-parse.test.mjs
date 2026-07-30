import assert from 'node:assert/strict'
import { parseOpenAICompatibleModels } from '../src/background/ai/api-key.ts'

// formato OpenAI-compatível (OpenRouter, OpenAI, Ollama, Groq…)
const resposta = { data: [
  { id: 'gpt-5', object: 'model' },
  { id: 'claude-opus-5', object: 'model' },
  { id: 'llama-4-70b', object: 'model' },
] }
assert.deepEqual(parseOpenAICompatibleModels(resposta), ['gpt-5', 'claude-opus-5', 'llama-4-70b'])

// resiliência: nada de exceção em resposta malformada
assert.deepEqual(parseOpenAICompatibleModels(null), [])
assert.deepEqual(parseOpenAICompatibleModels({}), [])
assert.deepEqual(parseOpenAICompatibleModels({ data: 'nao-e-array' }), [])
assert.deepEqual(parseOpenAICompatibleModels({ data: [{ semId: 1 }, { id: '' }, { id: 'ok' }] }), ['ok'])

console.log('✓ ai-models-parse (api-key): 5 asserções passaram')

import { parseCodexModels } from '../src/background/ai/openai-oauth.ts'

// formato do backend do Codex: {models:[{slug, visibility, priority}]}
const codex = { models: [
  { slug: 'gpt-5.2-codex', visibility: 'visible', priority: 1 },
  { slug: 'gpt-5-codex-mini', visibility: 'visible', priority: 3 },
  { slug: 'modelo-escondido', visibility: 'hidden', priority: 2 },
  { slug: 'outro-escondido', visibility: 'HIDE', priority: 0 },
  { slug: 'sem-prioridade' },
] }
// ordena por priority; visibility hidden/hide são descartados; sem priority vai pro fim
assert.deepEqual(parseCodexModels(codex), ['gpt-5.2-codex', 'gpt-5-codex-mini', 'sem-prioridade'])

assert.deepEqual(parseCodexModels(null), [])
assert.deepEqual(parseCodexModels({ models: 'nao-e-array' }), [])
assert.deepEqual(parseCodexModels({ models: [{ slug: '  ' }, { naoTemSlug: 1 }] }), [])

console.log('✓ ai-models-parse (codex): 4 asserções passaram')
