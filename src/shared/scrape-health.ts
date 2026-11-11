// Tipo, chave e regra do aviso de saúde do scraper. Vive em shared/ (sem import
// de db.ts) porque a sidebar, que roda no youtube.com, também os usa; quando
// moravam em background/channel-poller.ts, importá-los arrastava shared/db.ts
// para o bundle injetado na página.

/**
 * Diagnóstico da última varredura. Existe porque as duas falhas do scraper são
 * MUDAS: o Home fica vazio e isso é indistinguível de "não há vídeo novo".
 *
 * - `emptyChannels`: o parser não achou vídeo nenhum. Sinal de que a página do
 *   YouTube mudou de formato.
 * - `undatedChannels`: achou vídeos, mas não entendeu a data de NENHUM. Como
 *   `publishedAt` vira 0 e a regra de "novo" exige data acima do piso de 7 dias,
 *   esses vídeos nunca aparecem. É o que acontece com conta cujo idioma não é
 *   inglês nem português — o YouTube ignora Accept-Language para conta logada.
 */
export interface ScrapeHealth {
  checkedAt: number
  total: number
  emptyChannels: number
  undatedChannels: number
}

export const SCRAPE_HEALTH_KEY = 'mytube-scrape-health'

/** Só grita quando a falha é do conjunto, não de um canal que saiu do ar. */
const UNHEALTHY_RATIO = 0.6

export function isUnhealthy(h: ScrapeHealth): boolean {
  if (h.total < 3) return false
  return (h.emptyChannels + h.undatedChannels) / h.total >= UNHEALTHY_RATIO
}
