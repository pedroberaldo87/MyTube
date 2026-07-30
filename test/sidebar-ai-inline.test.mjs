import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { t } from '../src/shared/i18n.ts'

// INVARIANTE: a configuração de IA mora DENTRO do painel da engrenagem.
//
// A regressão que este guarda tranca já aconteceu: a seção de IA era um rótulo
// e um botão "Configurar" que despachava OPEN_OPTIONS_PAGE e teleportava o
// usuário para o dashboard em tela cheia. Mover o teleporte de lugar não é
// conserto. A interface do app é a sidebar; a única tela cheia é a Home.
//
// Então: nenhuma tela da sidebar despacha OPEN_OPTIONS_PAGE, o SettingsPanel
// renderiza a AISection, e a AISection tem a configuração INTEIRA (listar,
// ativar, testar, escolher modelo, editar, remover, adicionar endpoint,
// conectar conta ChatGPT e o painel do código do device flow).

const SRC = new URL('../src/', import.meta.url).pathname
const PANEL = join(SRC, 'content/sidebar/components/SettingsPanel.tsx')
const AI = join(SRC, 'content/sidebar/components/AISection.tsx')

async function arquivos(dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...await arquivos(p))
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

async function existe(p) {
  try { await stat(p); return true } catch { return false }
}

/** Sem comentários: o comentário que EXPLICA o defeito não pode disparar o guarda. */
function semComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const panel = semComentarios(await readFile(PANEL, 'utf8'))
const ai = semComentarios(await readFile(AI, 'utf8'))

// ── 1. o painel renderiza a seção de IA, e não um botão que leva para fora ────

assert.match(
  panel, /import\s*\{\s*AISection\s*\}\s*from\s*'\.\/AISection'/,
  'SettingsPanel deixou de importar a AISection',
)
assert.match(
  panel, /<AISection\s*\/>/,
  'SettingsPanel não renderiza mais <AISection /> — a configuração de IA saiu do painel',
)
assert.equal(
  /OPEN_OPTIONS_PAGE/.test(panel), false,
  'SettingsPanel voltou a despachar OPEN_OPTIONS_PAGE — é teleporte para tela cheia, não configuração',
)
assert.equal(
  /openOptionsPage/.test(panel), false,
  'SettingsPanel chama openOptionsPage — a configuração não sai da sidebar',
)

// ── 2. nenhuma tela (sidebar ou dashboard) manda o usuário para as opções ─────

const telas = [
  ...await arquivos(join(SRC, 'content')),
  ...await arquivos(join(SRC, 'dashboard')),
]
assert.ok(telas.length >= 15, `esperava os fontes de tela do projeto, achei ${telas.length}`)
for (const f of telas) {
  const src = semComentarios(await readFile(f, 'utf8'))
  const rel = f.slice(SRC.length)
  assert.equal(
    /OPEN_OPTIONS_PAGE/.test(src), false,
    `${rel} despacha OPEN_OPTIONS_PAGE — nenhuma tela teleporta o usuário para o dashboard`,
  )
}

// ── 3. a AISection tem a configuração inteira, dentro da sidebar ──────────────

const ACOES = {
  'ai.sectionTitle': 'o título da seção',
  'ai.useThis': 'marcar o provedor ativo',
  'ai.test': 'testar o provedor',
  'ai.model': 'escolher o modelo',
  'ai.edit': 'editar o provedor',
  'ai.remove': 'remover o provedor',
  'ai.addEndpoint': 'adicionar endpoint por chave',
  'ai.connectChatGPT': 'conectar conta ChatGPT',
  'ai.deviceInstructions': 'o painel do código do device flow',
}
for (const [key, oQue] of Object.entries(ACOES)) {
  assert.ok(
    ai.includes(`t('${key}')`),
    `a AISection não oferece ${oQue} (chave ${key}) — a configuração ficou incompleta na sidebar`,
  )
}
assert.match(ai, /flow\.start\.userCode/, 'a AISection não mostra o código do device flow')
assert.match(
  ai, /import\s*\{[^}]*startDeviceFlow[^}]*\}\s*from\s*'\.\.\/deviceFlow'/,
  'a AISection não usa o deviceFlow da sidebar',
)

// o único passo que sai da sidebar é o ACEITE de permissão, e ele vai por mensagem
assert.match(
  ai, /ensureHostPermission/,
  'a AISection não pede permissão de host — salvar endpoint próprio falharia calado',
)
assert.equal(
  /chrome\.permissions/.test(ai), false,
  'a AISection toca chrome.permissions, que é undefined no mundo do content script',
)

// ── 4. toda chave t('…') da seção existe nas duas línguas ─────────────────────

const chaves = [...ai.matchAll(/\bt\('([^']+)'\)/g)].map(m => m[1])
assert.ok(chaves.length >= 20, `esperava as chaves da seção, achei ${chaves.length}`)
for (const key of new Set(chaves)) {
  for (const lang of ['en', 'pt-BR']) {
    const texto = t(key, lang)
    assert.ok(
      typeof texto === 'string' && texto.length > 0 && texto !== key,
      `${key} sem tradução em ${lang} — a sidebar mostraria a chave crua`,
    )
  }
}

// ── 5. a configuração não mora mais no dashboard ──────────────────────────────

assert.equal(
  await existe(join(SRC, 'dashboard/components/AIProviders.tsx')), false,
  'o dashboard voltou a ter a configuração de IA — ela mora na sidebar',
)
assert.equal(
  await existe(join(SRC, 'dashboard/deviceFlow.ts')), false,
  'o deviceFlow voltou para o dashboard — ele vive no mundo da sidebar',
)
assert.equal(
  await existe(join(SRC, 'content/sidebar/deviceFlow.ts')), true,
  'src/content/sidebar/deviceFlow.ts desapareceu',
)
const settings = semComentarios(await readFile(join(SRC, 'dashboard/pages/Settings.tsx'), 'utf8'))
assert.equal(
  /AIProviders/.test(settings), false,
  'o Settings do dashboard voltou a montar a configuração de IA',
)

console.log(`✓ sidebar-ai-inline: ${telas.length} telas checadas, ${new Set(chaves).size} chaves traduzidas`)
