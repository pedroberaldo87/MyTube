import type { AIConfig, AIConfigPublic, AIProvider, AIProviderPublic } from './types'

const AI_STORAGE_KEY = 'mytube-ai-providers'

/** Base fixa do backend que aceita o token OAuth do Codex. Não é api.openai.com. */
export const OPENAI_OAUTH_BASE_URL = 'https://chatgpt.com/backend-api/codex'

export async function getAIConfig(): Promise<AIConfig> {
  const result = await chrome.storage.local.get(AI_STORAGE_KEY)
  // Default construído a cada chamada: os handlers mutam o objeto lido, e um
  // singleton compartilhado guardaria mutações de saves que falharam.
  return (result[AI_STORAGE_KEY] as AIConfig | undefined) ?? { providers: [], activeProviderId: null }
}

export async function saveAIConfig(config: AIConfig): Promise<void> {
  await chrome.storage.local.set({ [AI_STORAGE_KEY]: config })
}

export function sanitizeProvider(provider: AIProvider): AIProviderPublic {
  return {
    id: provider.id,
    label: provider.label,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    model: provider.model,
    hasCredential: Boolean(provider.apiKey) || Boolean(provider.tokens?.accessToken),
  }
}

export function sanitizeConfig(config: AIConfig): AIConfigPublic {
  return {
    providers: config.providers.map(sanitizeProvider),
    activeProviderId: config.activeProviderId,
  }
}
