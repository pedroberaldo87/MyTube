import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// INVARIANTE: nenhum save pode CRIAR provedor. Um AI_SAVE_PROVIDER com id que já
// não existe mais não vira push silencioso, e não existe provedor ativo sem
// credencial invisível na tela.
//
// Caminho concreto: as linhas e o formulário são renderizados sem exclusão
// mútua, então com o formulário de EDIÇÃO aberto o botão Remover da mesma linha
// continua clicável. Depois do Remover, clicar em Salvar manda o id morto; o
// background (index.ts, case AI_SAVE_PROVIDER) faz
// `if (idx === -1) config.providers.push(message.payload)`, e o payload de uma
// edição vem SEM apiKey (chave vazia = "mantém a guardada"). O delete deixou
// activeProviderId null, e `if (!config.activeProviderId)` promove o
// ressuscitado a ATIVO. Resultado: provedor ativo sem credencial — e
// `hasCredential` não tinha nenhum consumidor na tela, então a falha era muda.
//
// Duas metades:
//  A. o componente sabe quando o formulário perdeu o alvo, e o reload o fecha —
//     sem fechar o formulário de provedor NOVO, que guarda digitação.
//  B. a tela mostra o provedor sem credencial (hasCredential deixa de ser morto).

globalThis.chrome = {
  runtime: { async sendMessage() { return { providers: [], activeProviderId: null } } },
  storage: { local: { async get() { return {} }, async set() {} } },
}

const ui = await import('../src/content/sidebar/components/AISection.tsx')
const src = await readFile(new URL('../src/content/sidebar/components/AISection.tsx', import.meta.url), 'utf8')
const { t } = await import('../src/shared/i18n.ts')

// ── A. o formulário órfão é reconhecível ─────────────────────────────────────
assert.equal(
  typeof ui.formTargetGone, 'function',
  'AISection não tem como saber que o provedor editado deixou de existir: salvar o formulário órfão ressuscita o registro sem chave e o promove a ativo',
)

const p1 = { id: 'p1', label: 'Meu servidor', kind: 'api-key', baseUrl: 'http://100.100.100.100:8000/v1', model: 'qwen3', hasCredential: true }
const p2 = { ...p1, id: 'p2', label: 'Outro' }

// edição cujo alvo saiu da lista → órfã
assert.equal(
  ui.formTargetGone({ id: 'p1' }, []), true,
  'formulário editando um provedor removido não foi reconhecido como órfão',
)
assert.equal(
  ui.formTargetGone({ id: 'p1' }, [p2]), true,
  'lista não vazia sem o alvo: o formulário continua achando que edita algo',
)

// edição cujo alvo continua lá → intacta
assert.equal(
  ui.formTargetGone({ id: 'p1' }, [p1, p2]), false,
  'o formulário foi invalidado com o provedor ainda na lista — fecharia a edição em curso',
)

// formulário de provedor NOVO nunca é órfão: fechá-lo apagaria digitação
assert.equal(
  ui.formTargetGone({ id: null }, []), false,
  'o formulário de provedor novo foi tratado como órfão — o reload apagaria o que o usuário digitou',
)
assert.equal(
  ui.formTargetGone(null, [p1]), false,
  'sem formulário aberto não há nada a invalidar',
)

// ── A2. o reload realmente invalida (senão o helper é decoração) ──────────────
const reloadBody = /const reload = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/.exec(src)
assert.ok(reloadBody, 'AISection não tem mais um reload único — a invalidação do formulário não tem onde morar')
assert.ok(
  /formTargetGone/.test(reloadBody[1]),
  `o reload não invalida o formulário órfão: depois de Remover, Salvar ainda manda o id morto:\n${reloadBody[1]}`,
)
assert.ok(
  /setForm\(/.test(reloadBody[1]),
  'o reload reconhece o formulário órfão mas não o fecha',
)
// e não fecha cegamente a cada reload (isso apagaria digitação)
assert.equal(
  /setForm\(null\)(?![^\n]*formTargetGone)/.test(reloadBody[1]), false,
  'o reload fecha o formulário sem condição — apagaria a digitação do usuário a cada recarga',
)

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

console.log('✓ ai-form-orphan: 12 asserções passaram')
