import type { LicenseData, Tier } from './types'

// HMAC secret for license signing (obfuscated — not security-critical for v1)
const SECRET = 'gcc_v1_k8m2x9p4q7w1'

/**
 * Simple HMAC-SHA256 using SubtleCrypto (async) or fallback
 */
async function hmacSign(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const msgData = encoder.encode(data)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData)
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Verify an HMAC-SHA256 signature
 */
async function hmacVerify(data: string, secret: string, expectedSig: string): Promise<boolean> {
  const actual = await hmacSign(data, secret)
  return actual === expectedSig
}

/**
 * Generate a license key (for admin/payment webhook use)
 */
export async function generateLicenseKey(
  tier: Tier,
  email: string,
  validUntil: number // 0 = lifetime
): Promise<string> {
  const payload = { tier, email, exp: validUntil, iat: Date.now() }
  const payloadStr = JSON.stringify(payload)
  const payloadB64 = btoa(payloadStr)
  const sig = await hmacSign(payloadB64, SECRET)
  return `GCC-${payloadB64}-${sig}`
}

/**
 * Validate a license key and return parsed data, or null if invalid
 */
export async function validateLicenseKey(key: string): Promise<LicenseData | null> {
  try {
    const trimmed = key.trim().toUpperCase().startsWith('GCC-') ? key.trim() : null
    if (!trimmed) return null

    const parts = trimmed.split('-')
    if (parts.length < 3) return null

    // Rejoin the base64 part (it may contain hyphens in theory, though base64 doesn't use them)
    const prefix = parts[0] // GCC
    const sig = parts[parts.length - 1]
    const payloadB64 = parts.slice(1, -1).join('-')

    if (prefix !== 'GCC') return null

    // Verify signature
    const valid = await hmacVerify(payloadB64, SECRET, sig)
    if (!valid) return null

    // Decode payload
    const payloadStr = atob(payloadB64)
    const payload = JSON.parse(payloadStr) as {
      tier: Tier
      email: string
      exp: number
      iat: number
    }

    // Check expiry
    if (payload.exp > 0 && payload.exp < Date.now()) {
      return null // expired
    }

    return {
      key: trimmed,
      tier: payload.tier,
      email: payload.email,
      validUntil: payload.exp,
      activatedAt: payload.iat,
    }
  } catch {
    return null
  }
}

/**
 * Check if a license is currently valid (not expired)
 */
export function isLicenseValid(license: LicenseData): boolean {
  if (!license) return false
  if (license.validUntil === 0) return true // lifetime
  return license.validUntil > Date.now()
}

/**
 * Get the tier from stored license data (or 'free' if none/invalid)
 */
export function getTier(license: LicenseData | null): Tier {
  if (!license) return 'free'
  if (!isLicenseValid(license)) return 'free'
  return license.tier
}
