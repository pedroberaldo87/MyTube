import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// INVARIANTE: um provedor gravado sem credencial nunca é invisível na tela, e nenhum
// save pode CRIAR provedor por engano.
//
// A metade "formulário órfão" deste teste (formTargetGone) saiu com o formulário:
// editar um endpoint agora acontece na janela de chave da extensão, e o caso de
// editar um provedor que já foi removido — que ressuscitaria o registro SEM chave
// como ATIVO — é coberto em test/aikey-page.test.mjs (4. Orphan: sem botão Salvar).
// Fica aqui a metade B: hasCredential tem consumidor na tela.

globalThis.chrome = {
  runtime: { async sendMessage() { return { providers: [], activeProviderId: null } } },
  storage: { local: { async get() { return {} }, async set() {} } },
}

const src = await readFile(new URL('../src/content/sidebar/components/AISection.tsx', import.meta.url), 'utf8')
const { t } = await import('../src/shared/i18n.ts')

// ── B. provedor sem credencial deixa de ser invisível ────────────────────────
assert.ok(
  /hasCredential/.test(src),
  'hasCredential não tem consumidor na tela: um provedor ativo sem chave fica indistinguível de um configurado',
)
assert.ok(
  /!\s*p\.hasCredential/.test(src),
  'o aviso de credencial ausente não está condicionado a !p.hasCredential — ou alarma provedor configurado, ou nunca aparece',
)
const chaveAviso = /t\('(ai\.[A-Za-z]*[Cc]redential[A-Za-z]*)'\)/.exec(src)
assert.ok(chaveAviso, 'o aviso de credencial ausente não passa por i18n (texto cru no JSX)')
for (const lang of ['en', 'pt-BR']) {
  const texto = t(chaveAviso[1], lang)
  assert.ok(
    typeof texto === 'string' && texto.length > 0,
    `${chaveAviso[1]} não tem tradução em ${lang}`,
  )
}

console.log('✓ ai-form-orphan: hasCredential tem consumidor na tela')
