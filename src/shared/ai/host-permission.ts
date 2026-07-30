/**
 * Host permission helpers for custom AI endpoints.
 *
 * Um endpoint próprio é um host arbitrário, então não cabe no host_permissions
 * fixo. É pedido em runtime a partir do optional_host_permissions, o que exige
 * gesto do usuário — chame ensureHostPermission direto do handler de clique.
 */

/** Por que o retorno é tipado: "false" fazia a UI dizer "permissão negada"
 *  quando o Chrome tinha lançado antes de perguntar qualquer coisa. */
export type PermissionOutcome = 'granted' | 'invalid-url' | 'cannot-request' | 'denied'

/** Hosts que só existem em rede privada — inclusive a faixa 100.64/10 (CGNAT),
 *  que é a que o Tailscale usa. Endereço nessas faixas dificilmente fala https. */
function isPrivateHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.local')) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 127 || a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

/**
 * Aceita o endereço como o usuário o conhece e devolve uma URL completa.
 * Sem esquema, escolhe http para host privado e https para host público —
 * é o que faz `localhost:11434/v1` funcionar sem o usuário digitar `http://`.
 * Devolve null quando não há URL utilizável.
 */
/**
 * O host que o usuário escreveu parece mesmo um host?
 *
 * Não dá para delegar isso ao `new URL`: o parser do Chrome é permissivo e
 * transforma `nao é uma url` em `https://xn--nao%20%20uma%20url-gwb/` sem
 * reclamar (o do Node lança — foi por isso que o teste ficou verde enquanto a
 * tela aceitava lixo). Então a forma do host é checada no texto CRU, antes.
 */
function looksLikeHost(hostPart: string): boolean {
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(hostPart)) return false
  const host = hostPart.split(':')[0] ?? ''
  if (!/[A-Za-z0-9]/.test(host)) return false
  return host.split('.').every(label => label.length > 0 && !label.startsWith('-') && !label.endsWith('-'))
}

/** A parte de host de um endereço cru: sem esquema, sem caminho, sem query. */
function hostPartOf(raw: string): string {
  const semEsquema = raw.replace(/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//, '')
  return semEsquema.split(/[/?#]/)[0] ?? ''
}

export function normalizeEndpointUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (!looksLikeHost(hostPartOf(trimmed))) return null

  const hasScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
  if (hasScheme) {
    try {
      const u = new URL(trimmed)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
      if (!u.hostname) return null
      return u.href
    } catch {
      return null
    }
  }

  // Sem esquema: precisa parsear uma vez para descobrir o hostname.
  let probe: URL
  try {
    probe = new URL(`http://${trimmed}`)
  } catch {
    return null
  }
  if (!probe.hostname) return null
  const scheme = isPrivateHost(probe.hostname) ? 'http' : 'https'
  try {
    return new URL(`${scheme}://${trimmed}`).href
  } catch {
    return null
  }
}

/** Transforma a URL num match pattern de origem (`https://host/*`).
 *  `host` inclui a porta de propósito: o diálogo do Chrome aceitou
 *  `http://localhost:11434/*` numa verificação real. */
export function originFromUrl(url: string): string | null {
  try {
    const { protocol, host } = new URL(url)
    if (protocol !== 'https:' && protocol !== 'http:') return null
    if (!host) return null
    return `${protocol}//${host}/*`
  } catch {
    return null
  }
}

/**
 * Desvio para o mundo isolado do content script: lá `chrome` expõe dom,
 * extension, i18n, runtime e storage — `chrome.permissions` é undefined
 * (verificado por CDP na sidebar). O background abre a janelinha de permissão e
 * só responde quando o usuário decide, então o await aqui devolve o desfecho
 * real, não um "recebi".
 *
 * A mensagem é montada à mão em vez de usar `sendMessage` de shared/messages
 * para não fechar o ciclo messages.ts → types.ts → host-permission.ts.
 */
async function requestViaBackground(url: string): Promise<PermissionOutcome> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'AI_REQUEST_HOST_PERMISSION',
      payload: { url },
    })) as { outcome?: PermissionOutcome } | undefined
    return response?.outcome ?? 'cannot-request'
  } catch {
    // Canal morto (worker reiniciado no meio): não foi o usuário recusando.
    return 'cannot-request'
  }
}

/**
 * Garante que a extensão pode chamar a origem da URL dada.
 * Tem de rodar dentro de um gesto do usuário (clique).
 *
 * `request` é a PRIMEIRA instrução: um `permissions.contains` antes gastaria um
 * ida-e-volta assíncrono dentro do gesto, e o próprio request já devolve true
 * quando a permissão existe.
 */
export async function ensureHostPermission(raw: string): Promise<PermissionOutcome> {
  const normalized = normalizeEndpointUrl(raw)
  if (!normalized) return 'invalid-url'
  const origin = originFromUrl(normalized)
  if (!origin) return 'invalid-url'

  // Onde a API existe (página da extensão), pede direto — um clique, um diálogo.
  if (typeof chrome.permissions?.request !== 'function') {
    return await requestViaBackground(normalized)
  }

  try {
    const granted = await chrome.permissions.request({ origins: [origin] })
    return granted ? 'granted' : 'denied'
  } catch {
    // O Chrome lança quando a origem não está no optional_host_permissions.
    // Isso NÃO é o usuário recusando.
    return 'cannot-request'
  }
}
