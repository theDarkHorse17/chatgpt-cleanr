#!/usr/bin/env node

/**
 * License Key Generator for ChatGPT Cleaner
 *
 * Usage:
 *   node generate-key.js <tier> <email> [expiry-date]
 *
 * Examples:
 *   node generate-key.js pro user@example.com 2027-01-01
 *   node generate-key.js pro user@example.com lifetime
 *   node generate-key.js pro user@example.com 1y          (1 year from now)
 *
 * Outputs a GCC-... license key that can be activated in the extension.
 */

const SECRET = 'gcc_v1_k8m2x9p4q7w1'

async function hmacSign(data, secret) {
  const { subtle } = globalThis.crypto || require('crypto').webcrypto
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const msgData = encoder.encode(data)

  const cryptoKey = await subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await subtle.sign('HMAC', cryptoKey, msgData)
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function parseExpiry(input) {
  if (!input || input === 'lifetime' || input === '0') return 0

  // Relative: 1y, 6m, 30d
  const relMatch = input.match(/^(\d+)([ymd])$/)
  if (relMatch) {
    const num = parseInt(relMatch[1])
    const unit = relMatch[2]
    const now = Date.now()
    if (unit === 'y') return now + num * 365.25 * 24 * 60 * 60 * 1000
    if (unit === 'm') return now + num * 30 * 24 * 60 * 60 * 1000
    if (unit === 'd') return now + num * 24 * 60 * 60 * 1000
  }

  // Absolute date: YYYY-MM-DD
  const date = new Date(input)
  if (!isNaN(date.getTime())) return date.getTime()

  throw new Error(`Cannot parse expiry: ${input}`)
}

async function main() {
  const [,, tier, email, expiryInput] = process.argv

  if (!tier || !email) {
    console.log('Usage: node generate-key.js <tier> <email> [expiry]')
    console.log('')
    console.log('  tier:    pro | free')
    console.log('  email:   buyer email address')
    console.log('  expiry:  YYYY-MM-DD | 1y | 6m | 30d | lifetime (default: 1y)')
    process.exit(1)
  }

  if (!['pro', 'free'].includes(tier)) {
    console.error('Tier must be "pro" or "free"')
    process.exit(1)
  }

  const expiry = parseExpiry(expiryInput || '1y')
  const payload = { tier, email, exp: expiry, iat: Date.now() }
  const payloadStr = JSON.stringify(payload)
  const payloadB64 = Buffer.from(payloadStr).toString('base64')
  const sig = await hmacSign(payloadB64, SECRET)
  const key = `GCC-${payloadB64}-${sig}`

  console.log('')
  console.log('=== License Key Generated ===')
  console.log('')
  console.log(`  Tier:    ${tier}`)
  console.log(`  Email:   ${email}`)
  console.log(`  Expires: ${expiry === 0 ? 'Never (lifetime)' : new Date(expiry).toLocaleDateString()}`)
  console.log('')
  console.log(`  Key: ${key}`)
  console.log('')
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
