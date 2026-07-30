import type {
  AIProvider,
  CategorizeFolder,
  CategorizeItem,
  CategorizeSuggestion,
  CategorizeTag,
} from '../../shared/ai/types'
import { complete } from './index'

/**
 * Uma chamada de inferência = um lote. O LOOP de lotes fica no content script,
 * pelo mesmo motivo do device flow: o service worker do MV3 morre em ~30s e
 * uma biblioteca de 300 canais são vários minutos de ida e volta. Aqui só
 * acontece o que cabe numa mensagem.
 */

/**
 * O item é referenciado por POSIÇÃO, não por id. Mandar UUID no prompt gasta
 * token e convida o modelo a inventar um id parecido que não casa com nada;
 * um número de 1 a 40 ele não erra, e o que não casar é descartado no parse.
 */
export function buildPrompt(
  items: CategorizeItem[],
  folders: CategorizeFolder[],
  tags: CategorizeTag[] = [],
): string {
  const folderList = folders.length > 0
    ? folders.map(f => `- ${f.name}`).join('\n')
    : '(nenhuma ainda)'

  const tagList = tags.length > 0
    ? tags.map(t => `- ${t.name}`).join('\n')
    : '(nenhuma ainda)'

  const itemList = items
    .map((it, i) => `${i + 1}. [${it.type}] ${it.name}`)
    .join('\n')

  return `Você organiza uma biblioteca do YouTube em pastas temáticas e tags.

PASTAS QUE JÁ EXISTEM:
${folderList}

TAGS QUE JÁ EXISTEM:
${tagList}

ITENS PARA CLASSIFICAR:
${itemList}

Cada item vai em UMA pasta e pode receber de zero a três tags.

Regras da pasta:
- Prefira SEMPRE uma pasta que já existe, se ela servir.
- Se nenhuma servir, proponha um nome de pasta novo: curto, temático e genérico o bastante para caber outros itens parecidos (ex.: "Programação", não "Tutoriais de Rust em 2024").
- Reutilize os nomes novos que você mesmo propôs em vez de criar uma pasta por item.

Regras das tags:
- Tag é transversal: ela atravessa pastas. "Iniciante", "Português", "Longo" são tags; "Programação" é pasta.
- Prefira SEMPRE uma tag que já existe. Só proponha nome novo quando nenhuma servir.
- Não repita a pasta como tag, e não invente tag quando nada evidente se aplica — devolva [] nesse caso.
- No máximo três por item.

Classifique todos os itens. Se estiver em dúvida na pasta, escolha a mais provável.

Responda SOMENTE com um array JSON, sem markdown e sem comentários, onde "n" é o
número do item, "folder" é o nome da pasta e "tags" é a lista de nomes de tag:
[{"n":1,"folder":"Programação","tags":["Iniciante"]},{"n":2,"folder":"Música","tags":[]}]`
}

/** Mesma normalização da busca de pastas: minúsculas e sem acento. */
function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

/**
 * O modelo entrega o array cercado de conversa ou de ```json``` com frequência
 * suficiente para não valer um JSON.parse direto. Recorta do primeiro `[` ao
 * último `]` e deixa o parser decidir.
 */
function extractArray(raw: string): unknown {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

export function parseSuggestions(
  raw: string,
  items: CategorizeItem[],
  folders: CategorizeFolder[],
): CategorizeSuggestion[] {
  const arr = extractArray(raw)
  if (!Array.isArray(arr)) return []

  const byName = new Map(folders.map(f => [norm(f.name), f.id]))
  const seen = new Set<string>()
  const out: CategorizeSuggestion[] = []

  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue
    const rec = entry as { n?: unknown; folder?: unknown; tags?: unknown }
    if (typeof rec.n !== 'number' || !Number.isInteger(rec.n)) continue
    const item = items[rec.n - 1]
    // Índice fora da faixa ou repetido: o lote é a verdade, a resposta não.
    if (!item || seen.has(item.id)) continue
    const name = typeof rec.folder === 'string' ? rec.folder.trim() : ''
    if (!name) continue
    seen.add(item.id)
    const existing = byName.get(norm(name))
    out.push({
      id: item.id,
      folderId: existing ?? null,
      newFolder: existing ? null : name,
      tags: parseTags(rec.tags),
    })
  }

  return out
}

/**
 * Teto de 3 por item, deduplicado sem diferenciar acento nem caixa. O teto está
 * no prompt e repetido aqui porque prompt é pedido, não garantia: o modelo às
 * vezes devolve dez, e dez tags por canal não é organização, é ruído.
 */
const MAX_TAGS = 3

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of value) {
    if (typeof t !== 'string') continue
    const name = t.trim()
    if (!name) continue
    const key = norm(name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length === MAX_TAGS) break
  }
  return out
}

export async function categorize(
  provider: AIProvider,
  items: CategorizeItem[],
  folders: CategorizeFolder[],
  tags: CategorizeTag[] = [],
): Promise<CategorizeSuggestion[]> {
  if (items.length === 0) return []
  const raw = await complete(provider, buildPrompt(items, folders, tags))
  return parseSuggestions(raw, items, folders)
}
