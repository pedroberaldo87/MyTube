import * as db from '../db'
import type { AIConfig, AIConfigPublic, AIProvider, AIProviderPublic } from './types'

const AI_STORAGE_KEY = 'mytube-ai-providers'

/** Base fixa do backend que aceita o token OAuth do Codex. Não é api.openai.com. */
export const OPENAI_OAUTH_BASE_URL = 'https://chatgpt.com/backend-api/codex'

/**
 * Chave ANTIGA em chrome.storage.local. Esse storage é legível pelo content
 * script do youtube.com sem passar pelo worker, então a config de IA (com chave
 * de API e tokens OAuth) não mora mais nele — ver db.ts. A chave só é lida aqui,
 * para migrar, e apagada.
 */
const LEGACY_STORAGE_KEY = 'mytube-ai-providers'

function isAIConfig(value: unknown): value is AIConfig {
  return Boolean(value) && typeof value === 'object'
    && Array.isArray((value as { providers?: unknown }).providers)
}

let queue: Promise<unknown> = Promise.resolve()
/** Serializa a migração: duas leituras simultâneas na primeira partida não importam duas vezes. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

/**
 * Migra a config antiga (UMA vez, na primeira partida) e, em toda chamada,
 * apaga a chave antiga se ela existir. Depois da migração a chave antiga nunca
 * mais é importada: um registro que apareça ali é escrita de quem tem acesso ao
 * storage.local (um content script), não da extensão.
 */
async function settleLegacyStorage(): Promise<void> {
  const result = await chrome.storage.local.get(LEGACY_STORAGE_KEY)
  const legacy = result[LEGACY_STORAGE_KEY]
  const migrated = await db.isAIConfigMigrated()
  if (!migrated) await db.completeAIConfigMigration(isAIConfig(legacy) ? legacy : undefined)
  if (LEGACY_STORAGE_KEY in result) await chrome.storage.local.remove(LEGACY_STORAGE_KEY)
}

export async function getAIConfig(): Promise<AIConfig> {
  await serial(settleLegacyStorage)
  const record = await db.getAIConfigRecord()
  // Default construído a cada chamada: os handlers mutam o objeto lido, e um
  // singleton compartilhado guardaria mutações de saves que falharam.
  return isAIConfig(record) ? record : { providers: [], activeProviderId: null }
}

export async function saveAIConfig(config: AIConfig): Promise<void> {
  await serial(settleLegacyStorage)
  await db.putAIConfigRecord(config)
}

/** Apaga a chave antiga já na partida do worker, sem esperar a primeira leitura. */
export async function purgeLegacyAIStorage(): Promise<void> {
  await serial(settleLegacyStorage)
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
