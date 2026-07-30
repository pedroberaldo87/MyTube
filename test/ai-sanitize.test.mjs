import assert from 'node:assert/strict'
import { sanitizeProvider, sanitizeConfig } from '../src/shared/ai/storage.ts'

const comSegredo = {
  id: 'p1', label: 'OpenRouter', kind: 'api-key',
  baseUrl: 'https://openrouter.ai/api/v1', model: 'gpt-5',
  apiKey: 'sk-SEGREDO-NAO-PODE-VAZAR',
}
const comTokens = {
  id: 'p2', label: 'Minha conta ChatGPT', kind: 'openai-oauth',
  baseUrl: 'https://chatgpt.com/backend-api/codex', model: null,
  tokens: { accessToken: 'AT-SEGREDO', refreshToken: 'RT-SEGREDO', obtainedAt: 1 },
}

// 1. chave nunca aparece
const pub1 = sanitizeProvider(comSegredo)
assert.equal(JSON.stringify(pub1).includes('SEGREDO'), false, 'apiKey vazou na forma pública')
assert.equal(pub1.hasCredential, true)
assert.equal(pub1.label, 'OpenRouter')

// 2. tokens nunca aparecem
const pub2 = sanitizeProvider(comTokens)
assert.equal(JSON.stringify(pub2).includes('SEGREDO'), false, 'tokens vazaram na forma pública')
assert.equal(pub2.hasCredential, true)

// 3. provedor sem credencial marca hasCredential=false
const semCred = { id: 'p3', label: 'Ollama', kind: 'api-key', baseUrl: 'http://localhost:11434/v1', model: null }
assert.equal(sanitizeProvider(semCred).hasCredential, false)

// 4. a config inteira também não vaza
const saida = sanitizeConfig({ providers: [comSegredo, comTokens, semCred], activeProviderId: 'p1' })
assert.equal(JSON.stringify(saida).includes('SEGREDO'), false, 'sanitizeConfig vazou segredo')
assert.equal(saida.providers.length, 3)
assert.equal(saida.activeProviderId, 'p1')

console.log('✓ ai-sanitize: 4 asserções passaram')
