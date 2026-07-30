export type AIProviderKind = 'openai-oauth' | 'api-key'

export interface AITokens {
  accessToken: string
  refreshToken: string
  obtainedAt: number
}

export interface AIProvider {
  id: string
  label: string
  kind: AIProviderKind
  baseUrl: string
  model: string | null
  apiKey?: string
  tokens?: AITokens
}

export interface AIConfig {
  providers: AIProvider[]
  activeProviderId: string | null
}

/** Forma que sai do service worker. NUNCA contém credencial. */
export interface AIProviderPublic {
  id: string
  label: string
  kind: AIProviderKind
  baseUrl: string
  model: string | null
  hasCredential: boolean
}

export interface AIConfigPublic {
  providers: AIProviderPublic[]
  activeProviderId: string | null
}

// ── Categorização ─────────────────────────────────────────────────────────────

/** O que a IA precisa saber de um item. Nada de id do YouTube, thumb ou url. */
export interface CategorizeItem {
  id: string
  name: string
  type: 'channel' | 'playlist' | 'video'
}

export interface CategorizeFolder {
  id: string
  name: string
}

/**
 * Tag é a outra metade do que a barra manual faz. Diferente de pasta em uma
 * coisa que muda tudo: pasta é UMA por item, tag são VÁRIAS — por isso a
 * sugestão traz nomes, nunca ids, e a UI resolve nome → tag existente ou nova.
 */
export interface CategorizeTag {
  id: string
  name: string
}

/**
 * `folderId` e `newFolder` são exclusivos: ou a IA caiu numa pasta que já existe,
 * ou propôs um nome. Quem cria a pasta é a UI, depois do usuário aprovar — o
 * background não escreve nada no estado por conta de um palpite de modelo.
 */
export interface CategorizeSuggestion {
  id: string
  folderId: string | null
  newFolder: string | null
  /** Nomes de tag, na forma que o modelo devolveu. Vazio quando ele não sugeriu. */
  tags: string[]
}
