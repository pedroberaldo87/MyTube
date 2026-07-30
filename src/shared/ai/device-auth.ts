/**
 * Device flow proprietário da OpenAI, o mesmo que o Codex CLI usa.
 * Endpoints ficam em /api/accounts/deviceauth/*, fora do RFC 8628 — por isso
 * não aparecem no .well-known/openid-configuration.
 */
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const OPENAI_AUTH_ISSUER = 'https://auth.openai.com'
export const DEVICE_VERIFICATION_URL = `${OPENAI_AUTH_ISSUER}/codex/device`

export interface DeviceAuthStart {
  userCode: string
  deviceAuthId: string
  interval: number
  verificationUrl: string
}

export interface DeviceAuthCode {
  authorizationCode: string
  codeVerifier: string
}

/** Passo 1: pede o código que o usuário vai digitar. */
export async function beginDeviceAuth(): Promise<DeviceAuthStart> {
  const res = await fetch(`${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
  })
  if (!res.ok) throw new Error(`deviceauth/usercode devolveu HTTP ${res.status}`)
  const json = await res.json() as { user_code?: string; device_auth_id?: string; interval?: string | number }
  const userCode = json.user_code ?? ''
  const deviceAuthId = json.device_auth_id ?? ''
  if (!userCode || !deviceAuthId) throw new Error('resposta sem user_code ou device_auth_id')
  return {
    userCode,
    deviceAuthId,
    interval: Math.max(3, Number(json.interval ?? 5) || 5),
    verificationUrl: DEVICE_VERIFICATION_URL,
  }
}

/**
 * Passo 2: uma tentativa de polling.
 * 200 = autorizado. 403/404 = ainda não autorizou. Qualquer outro = erro real.
 */
export async function pollDeviceAuthOnce(
  deviceAuthId: string,
  userCode: string,
): Promise<DeviceAuthCode | null> {
  const res = await fetch(`${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
  })
  if (res.status === 403 || res.status === 404) return null
  if (!res.ok) throw new Error(`deviceauth/token devolveu HTTP ${res.status}`)
  const json = await res.json() as { authorization_code?: string; code_verifier?: string }
  const authorizationCode = json.authorization_code ?? ''
  const codeVerifier = json.code_verifier ?? ''
  if (!authorizationCode || !codeVerifier) {
    throw new Error('resposta sem authorization_code ou code_verifier')
  }
  return { authorizationCode, codeVerifier }
}
