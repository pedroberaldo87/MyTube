import {
  CODEX_CLIENT_ID,
  OPENAI_AUTH_ISSUER,
  type DeviceAuthCode,
} from '../../shared/ai/device-auth'
import type { AIProvider, AITokens } from '../../shared/ai/types'

const TOKEN_URL = `${OPENAI_AUTH_ISSUER}/oauth/token`
/** O redirect é da própria OpenAI — não precisamos registrar nenhum. */
const DEVICE_REDIRECT_URI = `${OPENAI_AUTH_ISSUER}/deviceauth/callback`
/** Renova quando o token passa disto. O access_token do Codex dura ~1h. */
const REFRESH_AFTER_MS = 45 * 60 * 1000

/** Passo 3: troca o authorization_code por access_token + refresh_token. */
export async function exchangeDeviceCode(code: DeviceAuthCode): Promise<AITokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code.authorizationCode,
      code_verifier: code.codeVerifier,
      redirect_uri: DEVICE_REDIRECT_URI,
      client_id: CODEX_CLIENT_ID,
    }),
  })
  if (!res.ok) throw new Error(`troca de código devolveu HTTP ${res.status}`)
  const json = await res.json() as { access_token?: string; refresh_token?: string }
  if (!json.access_token) throw new Error('troca de código não devolveu access_token')
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? '',
    obtainedAt: Date.now(),
  }
}

export async function refreshTokens(tokens: AITokens): Promise<AITokens> {
  if (!tokens.refreshToken) throw new Error('sem refresh_token — precisa conectar de novo')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: CODEX_CLIENT_ID,
    }),
  })
  if (!res.ok) throw new Error(`renovação devolveu HTTP ${res.status} — precisa conectar de novo`)
  const json = await res.json() as { access_token?: string; refresh_token?: string }
  if (!json.access_token) throw new Error('renovação não devolveu access_token')
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? tokens.refreshToken,
    obtainedAt: Date.now(),
  }
}

/** Sob demanda: devolve os tokens válidos, renovando se preciso. */
export async function validTokens(tokens: AITokens): Promise<AITokens> {
  if (Date.now() - tokens.obtainedAt < REFRESH_AFTER_MS) return tokens
  return refreshTokens(tokens)
}

/**
 * O backend do Codex devolve {models:[{slug, visibility, priority}]}.
 * Descarta visibility hidden/hide; ordena por priority (ausente vai pro fim).
 */
export function parseCodexModels(json: unknown): string[] {
  if (!json || typeof json !== 'object') return []
  const models = (json as { models?: unknown }).models
  if (!Array.isArray(models)) return []
  const sortable: { rank: number; slug: string }[] = []
  for (const item of models) {
    if (!item || typeof item !== 'object') continue
    const rec = item as { slug?: unknown; visibility?: unknown; priority?: unknown }
    if (typeof rec.slug !== 'string' || !rec.slug.trim()) continue
    const visibility = typeof rec.visibility === 'string' ? rec.visibility.trim().toLowerCase() : ''
    if (visibility === 'hide' || visibility === 'hidden') continue
    const rank = typeof rec.priority === 'number' ? rec.priority : 10_000
    sortable.push({ rank, slug: rec.slug.trim() })
  }
  sortable.sort((a, b) => (a.rank - b.rank) || a.slug.localeCompare(b.slug))
  return sortable.map(x => x.slug)
}

export async function listModelsOAuth(provider: AIProvider): Promise<string[]> {
  if (!provider.tokens) throw new Error('provedor OAuth sem tokens')
  const tokens = await validTokens(provider.tokens)
  const res = await fetch(`${provider.baseUrl}/models?client_version=1.0.0`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ao listar modelos do Codex`)
  return parseCodexModels(await res.json())
}

/**
 * Um `HTTP 400` sozinho não é diagnóstico — é o servidor dizendo "seu pedido está
 * errado" e nós jogando fora a frase seguinte, em que ele diz ONDE. Sem isto, a
 * única saída era adivinhar qual campo o backend recusou.
 */
export async function errorDetail(res: Response): Promise<string> {
  let body: string
  try {
    body = (await res.text()).trim()
  } catch {
    return 'corpo da resposta ilegível'
  }
  if (!body) return 'sem corpo na resposta'
  // A forma comum é {"error":{"message":"..."}}; texto cru passa direto.
  try {
    const json = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
    const msg = typeof json.error === 'string' ? json.error : json.error?.message ?? json.message
    if (typeof msg === 'string' && msg) return msg
  } catch { /* não era JSON */ }
  return body.slice(0, 400)
}

/**
 * O backend do Codex NÃO devolve JSON: exige `stream: true` e responde um fluxo
 * SSE — recusa `stream:false` com {"detail":"Stream must be set to true"}. Este
 * parser foi escrito a partir da captura de um fluxo REAL, não da especificação:
 *
 *   event: response.output_text.delta
 *   data: {"type":"response.output_text.delta","delta":"Program", ...}
 *   ...
 *   event: response.completed
 *   data: {"type":"response.completed","response":{"output":[{"type":"message",
 *          "content":[{"type":"output_text","text":"..."}]}], ...}}
 *
 * O texto vem picado em deltas de 1 a 7 caracteres, e é dali que ele sai. Na
 * captura real o `response.completed` chega com `output: []` VAZIO — quem
 * parseasse só o evento final, que é a leitura natural da doc da Responses API,
 * receberia string vazia EM SILÊNCIO. O `completed` fica como rede, nunca como
 * fonte principal.
 *
 * Detalhe que quebra o caminho ingênuo: a resposta vem com `content-type` NULO,
 * então `res.json()` estoura — foi o que aconteceu na versão anterior.
 */
export function parseResponsesStream(raw: string): string {
  let deltas = ''
  let completed = ''
  for (const block of raw.split('\n\n')) {
    // `data:` pode ocupar mais de uma linha no mesmo evento; o SSE manda juntá-las.
    const payload = block
      .split('\n')
      .filter(l => l.startsWith('data:'))
      .map(l => l.slice(5).trim())
      .join('\n')
    if (!payload || payload === '[DONE]') continue
    let ev: { type?: string; delta?: unknown; response?: unknown }
    try {
      ev = JSON.parse(payload) as typeof ev
    } catch {
      continue
    }
    if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') {
      deltas += ev.delta
    } else if (ev.type === 'response.completed') {
      completed = textFromResponse(ev.response)
    }
  }
  return deltas || completed
}

function textFromResponse(response: unknown): string {
  const output = (response as { output?: unknown })?.output
  if (!Array.isArray(output)) return ''
  let out = ''
  for (const item of output) {
    const content = (item as { content?: unknown })?.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      const rec = part as { type?: unknown; text?: unknown }
      if (rec.type === 'output_text' && typeof rec.text === 'string') out += rec.text
    }
  }
  return out
}

export async function completeOAuth(provider: AIProvider, prompt: string): Promise<string> {
  if (!provider.tokens) throw new Error('provedor OAuth sem tokens')
  const tokens = await validTokens(provider.tokens)
  const res = await fetch(`${provider.baseUrl}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      'Content-Type': 'application/json',
    },
    // Mesmo teto do adaptador por chave — inferência lenta não pode virar espera infinita.
    signal: AbortSignal.timeout(180_000),
    // `input` é LISTA, nunca string — o backend responde
    // {"detail":"Input must be a list"} para a forma curta. O item segue a
    // serialização de ResponseItem::Message da implementação de referência
    // (openai/codex → protocol/src/models.rs): tag `type`, content em array de
    // ContentItem, texto de entrada como `input_text`.
    body: JSON.stringify({
      model: provider.model,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }],
      // Os dois são exigidos pelo backend, e ele diz isso em texto claro:
      // {"detail":"Store must be set to false"} / {"detail":"Stream must be set to true"}.
      store: false,
      stream: true,
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} na chamada de inferência do Codex — ${await errorDetail(res)}`)
  return parseResponsesStream(await res.text())
}
