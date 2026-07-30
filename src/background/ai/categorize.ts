import type {
  AIProvider,
  CategorizeFolder,
  CategorizeItem,
  CategorizeSuggestion,
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
export function buildPrompt(items: CategorizeItem[], folders: CategorizeFolder[]): string {
  const folderList = folders.length > 0
    ? folders.map(f => `- ${f.name}`).join('\n')
    : '(nenhuma ainda)'

  const itemList = items
    .map((it, i) => `${i + 1}. [${it.type}] ${it.name}`)
    .join('\n')

  return `Você organiza uma biblioteca do YouTube em pastas temáticas.

PASTAS QUE JÁ EXISTEM:
${folderList}

ITENS PARA CLASSIFICAR:
${itemList}

Regras:
- Prefira SEMPRE uma pasta que já existe, se ela servir.
- Se nenhuma servir, proponha um nome de pasta novo: curto, temático e genérico o bastante para caber outros itens parecidos (ex.: "Programação", não "Tutoriais de Rust em 2024").
- Reutilize os nomes novos que você mesmo propôs em vez de criar uma pasta por item.
- Classifique todos os itens. Se estiver em dúvida, escolha a pasta mais provável.

Responda SOMENTE com um array JSON, sem markdown e sem comentários, onde "n" é o
número do item e "folder" é o nome da pasta:
[{"n":1,"folder":"Programação"},{"n":2,"folder":"Música"}]`
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
    const rec = entry as { n?: unknown; folder?: unknown }
    if (typeof rec.n !== 'number' || !Number.isInteger(rec.n)) continue
    const item = items[rec.n - 1]
    // Índice fora da faixa ou repetido: o lote é a verdade, a resposta não.
    if (!item || seen.has(item.id)) continue
    const name = typeof rec.folder === 'string' ? rec.folder.trim() : ''
    if (!name) continue
    seen.add(item.id)
    const existing = byName.get(norm(name))
    out.push(existing
      ? { id: item.id, folderId: existing, newFolder: null }
      : { id: item.id, folderId: null, newFolder: name })
  }

  return out
}

export async function categorize(
  provider: AIProvider,
  items: CategorizeItem[],
  folders: CategorizeFolder[],
): Promise<CategorizeSuggestion[]> {
  if (items.length === 0) return []
  const raw = await complete(provider, buildPrompt(items, folders))
  return parseSuggestions(raw, items, folders)
}
