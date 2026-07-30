import type { AIProvider } from '../../shared/ai/types'
// Mora no adaptador OAuth porque foi lá que a falta dele doeu; vale para os dois.
import { errorDetail } from './openai-oauth'

export function parseOpenAICompatibleModels(json: unknown): string[] {
  if (!json || typeof json !== 'object') return []
  const data = (json as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  const out: string[] = []
  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const id = (item as { id?: unknown }).id
    if (typeof id === 'string' && id.trim()) out.push(id.trim())
  }
  return out
}

function authHeaders(provider: AIProvider): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`
  return headers
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}${path}`
}

export async function listModelsApiKey(provider: AIProvider): Promise<string[]> {
  const res = await fetch(joinUrl(provider.baseUrl, '/models'), { headers: authHeaders(provider) })
  if (!res.ok) throw new Error(`HTTP ${res.status} ao listar modelos em ${provider.baseUrl}`)
  return parseOpenAICompatibleModels(await res.json())
}

/**
 * Teto de 3 min por chamada. Medido num endpoint real (Qwen3.6-35B via omlx): um
 * lote de 40 itens levou 93s e um de 15, 64s — inferência é lenta o bastante para
 * um teto apertado cortar trabalho legítimo, e lenta o bastante para que SEM teto
 * um servidor que engasga deixe a tela esperando para sempre.
 */
const COMPLETION_TIMEOUT_MS = 180_000

/**
 * Categorizar não precisa de cadeia de raciocínio, e num modelo "thinking" ela é
 * praticamente TODO o custo. Medido no mesmo endpoint, mesmo lote de 20 itens:
 *
 *   sem nada                              106,1s · 16.328 chars de reasoning
 *   reasoning_effort: 'none'               85,7s · 11.995 chars
 *   chat_template_kwargs.enable_thinking   4,8s  ·      0 chars   ← 22× mais rápido
 *
 * O parse casou 20/20 nos três — desligar o raciocínio não custou qualidade aqui.
 * Numa biblioteca de 813 itens isso é ~3,5 min em vez de ~42 min.
 *
 * O campo é convenção de vLLM/SGLang/omlx, NÃO da API da OpenAI — que recusa
 * argumento desconhecido com 400. Por isso a chamada é otimista e o 400 tem uma
 * segunda tentativa sem o campo: o fallback é exatamente o comportamento que
 * funcionava antes, só mais lento, nunca uma versão capenga.
 */
const FAST_HINT = { chat_template_kwargs: { enable_thinking: false } }

export async function completeApiKey(provider: AIProvider, prompt: string): Promise<string> {
  const post = (extra: object) => fetch(joinUrl(provider.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: authHeaders(provider),
    signal: AbortSignal.timeout(COMPLETION_TIMEOUT_MS),
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: 'user', content: prompt }],
      ...extra,
    }),
  })

  let res = await post(FAST_HINT)
  // Só o 400 é ambíguo entre "campo que não conheço" e "pedido ruim". 401/404/500
  // não melhoram numa retentativa e sobem com o motivo do servidor.
  if (res.status === 400) res = await post({})
  if (!res.ok) throw new Error(`HTTP ${res.status} na chamada de inferência — ${await errorDetail(res)}`)
  const json = await res.json() as { choices?: { message?: { content?: string } }[] }
  return json.choices?.[0]?.message?.content ?? ''
}
