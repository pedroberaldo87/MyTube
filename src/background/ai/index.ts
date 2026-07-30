import type { AIProvider } from '../../shared/ai/types'
import { listModelsApiKey, completeApiKey } from './api-key'
import { listModelsOAuth, completeOAuth } from './openai-oauth'

export interface AITestResult {
  ok: boolean
  error?: string
  latencyMs?: number
  modelCount?: number
}

export async function listModels(provider: AIProvider): Promise<string[]> {
  return provider.kind === 'openai-oauth'
    ? listModelsOAuth(provider)
    : listModelsApiKey(provider)
}

export async function complete(provider: AIProvider, prompt: string): Promise<string> {
  return provider.kind === 'openai-oauth'
    ? completeOAuth(provider, prompt)
    : completeApiKey(provider, prompt)
}

/**
 * Testar = listar modelos. É a checagem mais barata que prova que a credencial
 * funciona, não gasta token de inferência, e já traz o insumo do seletor.
 * Devolve a mensagem de erro real do provedor, não um "falhou" genérico.
 */
export async function testProvider(provider: AIProvider): Promise<AITestResult> {
  const started = Date.now()
  try {
    const models = await listModels(provider)
    return { ok: true, latencyMs: Date.now() - started, modelCount: models.length }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
