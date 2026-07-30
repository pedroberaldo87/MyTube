import assert from 'node:assert/strict'
import { diagnose, isUnhealthy } from '../src/background/channel-poller.ts'

// INVARIANTE: quando o scraper para de funcionar, ALGUÉM avisa.
//
// As duas falhas do scraper são mudas por natureza: o Home fica vazio, e vazio é
// exatamente como "não há vídeo novo" se parece. O aviso do console do service
// worker não conta — ninguém abre. Este diagnóstico é o que a sidebar lê para
// gritar na tela.

const ok = e => ({ videoId: e, title: 't', publishedAt: Date.now(), thumbnailUrl: '', channelName: 'c', channelId: 'c' })
const semData = e => ({ ...ok(e), publishedAt: 0 })
const mapa = pares => new Map(pares)

// ── formato da página mudou: ninguém extrai vídeo ────────────────────────────

const quebrado = diagnose(mapa([['a', []], ['b', []], ['c', []], ['d', []]]))
assert.equal(quebrado.emptyChannels, 4)
assert.equal(quebrado.undatedChannels, 0)
assert.ok(isUnhealthy(quebrado), 'quatro canais sem nenhum vídeo tem de acender o aviso')

// ── conta em outro idioma: extrai vídeo, não entende data nenhuma ────────────

const semDatas = diagnose(mapa([
  ['a', [semData('v1'), semData('v2')]],
  ['b', [semData('v3')]],
  ['c', [semData('v4')]],
]))
assert.equal(semDatas.emptyChannels, 0, 'os vídeos foram extraídos — o problema é a data')
assert.equal(semDatas.undatedChannels, 3)
assert.ok(isUnhealthy(semDatas), 'vídeo sem data nunca aparece como novo; isso tem de avisar')

// ── funcionando: não pode gritar ─────────────────────────────────────────────

const saudavel = diagnose(mapa([['a', [ok('v1')]], ['b', [ok('v2')]], ['c', [ok('v3')]], ['d', [ok('v4')]]]))
assert.equal(isUnhealthy(saudavel), false, 'alarme falso é pior que alarme nenhum — ensina a ignorar')

// um canal que saiu do ar, no meio de outros que funcionam, NÃO é falha do scraper
const umFora = diagnose(mapa([['a', []], ['b', [ok('v2')]], ['c', [ok('v3')]], ['d', [ok('v4')]]]))
assert.equal(umFora.emptyChannels, 1)
assert.equal(isUnhealthy(umFora), false, '1 de 4 é canal deletado, não formato quebrado')

// data parcial também é vídeo aparecendo: só conta como falha se NENHUM tem data
const parcial = diagnose(mapa([['a', [semData('v1'), ok('v2')]], ['b', [ok('v3')]], ['c', [ok('v4')]]]))
assert.equal(parcial.undatedChannels, 0, 'um vídeo com data no canal já basta para ele não ser "sem data"')

// ── biblioteca minúscula não tem amostra para concluir nada ──────────────────

assert.equal(isUnhealthy(diagnose(mapa([['a', []], ['b', []]]))), false, '2 canais não é amostra')

console.log('✓ scrape-health: 11 asserções — as duas falhas mudas passam a gritar, e alarme falso não')
