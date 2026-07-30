import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  extractYtInitialData,
  deepFindVideos,
  parseRelativeDate,
} from '../src/background/channel-scraper.ts'

// INVARIANTE: o caminho HTML → ytInitialData → lockup → vídeo continua extraindo vídeo.
//
// Este é o ponto do projeto que quebra primeiro quando o YouTube mexe na página,
// e era o único sem cobertura nenhuma. O modo de falha é o pior possível: o
// scraper escreve um `console.warn` no worker e devolve lista vazia, então o
// Home fica vazio e isso é indistinguível de "não há vídeo novo".
//
// A fixture NÃO foi escrita à mão: é a `ytInitialData` de uma página real de
// /videos (youtube.com/@Fireship), reduzida a três itens preservando o caminho
// que a página usa — richGridRenderer → richItemRenderer → lockupViewModel.
//
// O que este teste pega: alguém refatorar o parser e quebrar a extração.
// O que ele NÃO pega: o YouTube mudar o formato amanhã — para isso serve o aviso
// na tela quando vários canais seguidos voltam vazios (channel-poller.ts).

const HTML = readFileSync(new URL('./fixtures/youtube-channel-videos.html', import.meta.url), 'utf8')

// ── o HTML real ainda entrega o objeto ───────────────────────────────────────

const data = extractYtInitialData(HTML)
assert.ok(data && typeof data === 'object', 'não achou ytInitialData no HTML de uma página real')

// ── e o objeto real ainda entrega vídeos ─────────────────────────────────────

const videos = []
deepFindVideos(data, videos)

assert.equal(videos.length, 3, `esperava os 3 vídeos da fixture, extraiu ${videos.length}`)

for (const v of videos) {
  assert.match(v.videoId, /^[A-Za-z0-9_-]{11}$/, `videoId fora do formato do YouTube: ${v.videoId}`)
  assert.ok(v.title && v.title.length > 3, `título vazio para ${v.videoId}`)
  assert.match(v.thumbnailUrl, /^https:\/\//, `thumbnail não é URL: ${v.thumbnailUrl}`)
}

// ids reais da captura — se o parser passar a ler outro campo, isto não bate
assert.deepEqual(
  videos.map(v => v.videoId).sort(),
  ['KOpTWx1Eou4', 'YP73B9D20V4', 'jxGJT1weu4w'],
  'os ids extraídos não são os da página capturada',
)

// ── lixo não vira exceção ────────────────────────────────────────────────────

assert.equal(extractYtInitialData(''), null)
assert.equal(extractYtInitialData('<html><body>nada aqui</body></html>'), null)
assert.equal(extractYtInitialData('var ytInitialData = {isso nao fecha'), null, 'JSON quebrado derrubou o parser')

const vazio = []
deepFindVideos(null, vazio); deepFindVideos({}, vazio); deepFindVideos([1, 'x', null], vazio)
assert.equal(vazio.length, 0)

// ── datas: bilíngue, e é assim que `publishedAt` nasce ───────────────────────
//
// A data vem de texto relativo ("3 days ago"), nunca de timestamp — o YouTube
// devolve no idioma da conta mesmo com Accept-Language: en, então as duas
// línguas são caminho de produção, não conveniência.

const agora = Date.now()
const dia = 86_400_000
const casos = [
  ['3 days ago', 3 * dia], ['1 day ago', dia], ['2 weeks ago', 14 * dia],
  ['há 3 dias', 3 * dia], ['3 dias atrás', 3 * dia], ['há 1 semana', 7 * dia],
]
for (const [texto, esperado] of casos) {
  const delta = agora - parseRelativeDate(texto)
  assert.ok(
    Math.abs(delta - esperado) < 60_000,
    `"${texto}" virou ${(delta / dia).toFixed(1)} dias atrás, esperava ${(esperado / dia).toFixed(1)}`,
  )
}

// ── o que a função faz com o que NÃO reconhece, e por que isso importa ───────
//
// Devolve 0. Como `isNew` exige `publishedAt > max(seenUpToAt, agora − 7 dias)`
// (channel-poller.ts), data 0 significa NUNCA novo. Vale para live, estreia, e
// para toda conta cujo idioma do YouTube não é inglês nem português — nesse caso
// o feed de novidades fica vazio para sempre, sem erro nenhum.
//
// A asserção existe para travar o comportamento: quem mudar este retorno tem de
// olhar `diagnose()` no poller, que usa exatamente `publishedAt === 0` como a
// assinatura dessa falha para avisar na tela.
for (const naoReconhecido of ['sei lá quando', '', 'LIVE', 'hace 3 días', 'vor 3 Tagen']) {
  assert.equal(
    parseRelativeDate(naoReconhecido), 0,
    `"${naoReconhecido}" deveria cair em 0 — é a assinatura que diagnose() detecta`,
  )
}

console.log(`✓ channel-scraper-parse: ${videos.length} vídeos extraídos de uma página real + ${casos.length} formatos de data`)
