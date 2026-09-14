#!/usr/bin/env node
/**
 * Mint HS256 JWTs for local multi-user dsh testing.
 * Uses DSH_JWT_SECRET (same secret as auth-middleware / multi-user patch).
 *
 * Usage:
 *   $env:DSH_JWT_SECRET = "test-jwt-secret-at-least-32-chars!!"
 *   node scripts/mint-multi-user-jwt.mjs [sub ...]
 */
import { createHmac } from 'node:crypto'

const secret = process.env.DSH_JWT_SECRET
if (secret === undefined || secret.length < 32) {
  console.error('DSH_JWT_SECRET must be set and at least 32 characters')
  process.exit(1)
}

const subjects = process.argv.slice(2)
const users = subjects.length > 0 ? subjects : ['alice', 'bob']

/**
 * @param {string} sub
 * @returns {string}
 */
function mint(sub) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ sub, iat: now, exp: now + 3600 })).toString('base64url')
  const signingInput = `${header}.${payload}`
  const sig = createHmac('sha256', secret).update(signingInput).digest('base64url')
  return `${signingInput}.${sig}`
}

for (const sub of users) {
  console.log(`${sub.toUpperCase()}=${mint(sub)}`)
}
