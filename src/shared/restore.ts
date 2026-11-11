import type { WatchEntry } from './types'

/**
 * Regras do "Substituir" de um restore, em funções puras para valer igual na
 * sidebar e no dashboard (e para serem testáveis sem navegador).
 */

/**
 * O validador de backup exige `watchHistory` como lista. Backup sem a chave vira
 * `[]` só para passar por ele; quem decide se isso apaga algo é
 * `planHistoryReplace`, que olha o valor ORIGINAL. Valor que não é lista segue
 * como veio, e o validador rejeita o arquivo.
 */
export function normalizeHistoryField(raw: unknown): unknown {
  return raw === undefined ? [] : raw
}

/**
 * O que vai SUBSTITUIR o histórico atual, ou `null` para deixá-lo como está.
 *
 *  - chave ausente / não é lista            → null (backup antigo não apaga histórico);
 *  - lista não vazia sem nenhuma entrada válida → null (arquivo corrompido não apaga);
 *  - `watchHistory: []` explícito           → [] (o usuário exportou sem histórico).
 */
export function planHistoryReplace(rawHistory: unknown, sanitized: WatchEntry[]): WatchEntry[] | null {
  if (!Array.isArray(rawHistory)) return null
  if (rawHistory.length > 0 && sanitized.length === 0) return null
  return sanitized
}

/**
 * Passo a passo do "Substituir": histórico PRIMEIRO (atômico no IndexedDB), estado
 * depois. Se o histórico falhar, o `mytube_state` do usuário continua intacto.
 */
export async function restoreReplace(
  history: WatchEntry[] | null,
  replaceHistory: (entries: WatchEntry[]) => Promise<void>,
  writeState: () => Promise<void>,
): Promise<void> {
  if (history !== null) await replaceHistory(history)
  await writeState()
}
