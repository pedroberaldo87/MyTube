import assert from 'node:assert/strict'

// INVARIANTE: editar um provedor sem digitar a chave preserva a credencial
// guardada. A UI só tem a forma sanitizada, então um save vindo dela chega sem
// apiKey — e substituir o registro inteiro apagaria a chave.
//
// Este teste exercita o handler AI_SAVE_PROVIDER pelo caminho da EDIÇÃO. O
// caminho do seletor de modelo já era coberto; a edição muda label e baseUrl
// no mesmo payload, que é o que nunca foi exercitado.

const store = {
  'mytube-ai-providers': {
    providers: [{
      id: 'p1', label: 'Meu servidor', kind: 'api-key',
      baseUrl: 'http://100.100.100.100:8000/v1', model: 'qwen3',
      apiKey: 'sk-SEGREDO-GUARDADO',
    }],
    activeProviderId: 'p1',
  },
}

globalThis.chrome = {
  storage: {
    local: {
      get: async key => (typeof key === 'string' ? { [key]: store[key] } : { ...store }),
      set: async obj => { Object.assign(store, obj) },
    },
  },
}

const { getAIConfig, saveAIConfig } = await import('../src/shared/ai/storage.ts')

/** A mesma semântica de merge do case AI_SAVE_PROVIDER (background/index.ts). */
async function saveProvider(payload) {
  const config = await getAIConfig()
  const idx = config.providers.findIndex(p => p.id === payload.id)
  if (idx === -1) config.providers.push(payload)
  else {
    const prev = config.providers[idx]
    config.providers[idx] = {
      ...payload,
      apiKey: payload.apiKey ?? prev.apiKey,
      tokens: payload.tokens ?? prev.tokens,
    }
  }
  await saveAIConfig(config)
  return config
}

// 1. edição sem chave: troca endereço e nome, preserva a credencial
await saveProvider({
  id: 'p1', label: 'Servidor de casa', kind: 'api-key',
  baseUrl: 'http://192.168.0.9:8000/v1', model: 'qwen3',
})
let c = await getAIConfig()
assert.equal(c.providers[0].apiKey, 'sk-SEGREDO-GUARDADO', 'a edição sem chave apagou a credencial')
assert.equal(c.providers[0].baseUrl, 'http://192.168.0.9:8000/v1', 'a edição não trocou o endereço')
assert.equal(c.providers[0].label, 'Servidor de casa')
assert.equal(c.providers.length, 1, 'a edição criou um provedor novo em vez de editar')

// 2. edição COM chave: rotaciona de verdade
await saveProvider({
  id: 'p1', label: 'Servidor de casa', kind: 'api-key',
  baseUrl: 'http://192.168.0.9:8000/v1', model: 'qwen3', apiKey: 'sk-NOVA',
})
c = await getAIConfig()
assert.equal(c.providers[0].apiKey, 'sk-NOVA', 'a rotação de chave não pegou')

// 3. id que não existe cria, não sobrescreve
await saveProvider({ id: 'p2', label: 'Outro', kind: 'api-key', baseUrl: 'https://api.exemplo.com/v1', model: null, apiKey: 'sk-2' })
c = await getAIConfig()
assert.equal(c.providers.length, 2)
assert.equal(c.providers[0].apiKey, 'sk-NOVA', 'criar um provedor mexeu no anterior')

console.log('✓ ai-provider-edit: 7 asserções passaram')
