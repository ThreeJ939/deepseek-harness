#!/usr/bin/env node
/**
 * Smoke-test multi-user dsh against a running web server.
 * Usage:
 *   DSH_JWT_SECRET=... node scripts/smoke-multi-user-api.mjs [baseUrl]
 */
import { createHmac } from 'node:crypto'

const secret = process.env.DSH_JWT_SECRET
if (secret === undefined || secret.length < 32) {
  console.error('DSH_JWT_SECRET must be set and at least 32 characters')
  process.exit(1)
}

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:3080'

function mint(sub) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ sub, iat: now, exp: now + 3600 })).toString('base64url')
  const signingInput = `${header}.${payload}`
  const sig = createHmac('sha256', secret).update(signingInput).digest('base64url')
  return `${signingInput}.${sig}`
}

async function rpc(method, payload, token) {
  const url = `${baseUrl}/api/${method}`
  const body = JSON.stringify({
    type: 'client-request',
    rpcId: `${method}-${Date.now()}`,
    method,
    payload,
  })
  const headers = { 'content-type': 'application/json' }
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  const res = await fetch(url, { method: 'POST', headers, body })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`${method}: HTTP ${res.status}, non-JSON: ${text}`)
  }
  return { status: res.status, json }
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exit(1)
  }
}

const alice = mint('alice')
const bob = mint('bob')

console.log('1. 401 without token')
const noAuth = await fetch(`${baseUrl}/api/session.list`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'client-request', rpcId: '1', method: 'session.list', payload: {} }),
})
assert(noAuth.status === 401, `expected 401, got ${noAuth.status}`)
console.log('   OK')

console.log('2. alice creates session')
const createA = await rpc('session.create', {}, alice)
assert(createA.json.result?.ok === true, JSON.stringify(createA.json))
const sessionA = createA.json.result.value.sessionId
console.log(`   sessionId=${sessionA}`)

console.log('3. bob creates session')
const createB = await rpc('session.create', {}, bob)
assert(createB.json.result?.ok === true, JSON.stringify(createB.json))
const sessionB = createB.json.result.value.sessionId
console.log(`   sessionId=${sessionB}`)

console.log('4. alice list isolation')
const listA = await rpc('session.list', {}, alice)
assert(listA.json.result?.ok === true, JSON.stringify(listA.json))
const idsA = listA.json.result.value.items.map(i => i.sessionId)
assert(idsA.length === 1 && idsA[0] === sessionA, `alice list: ${JSON.stringify(idsA)}`)
console.log('   OK')

console.log('5. bob list isolation')
const listB = await rpc('session.list', {}, bob)
assert(listB.json.result?.ok === true, JSON.stringify(listB.json))
const idsB = listB.json.result.value.items.map(i => i.sessionId)
assert(idsB.length === 1 && idsB[0] === sessionB, `bob list: ${JSON.stringify(idsB)}`)
console.log('   OK')

console.log('6. alice cannot read bob session')
const hist = await rpc('session.history', { sessionId: sessionB }, alice)
assert(hist.json.result?.ok === false, JSON.stringify(hist.json))
assert(hist.json.result.error.code === 'unauthorized', JSON.stringify(hist.json.result.error))
console.log('   OK')

console.log('7. credential write denied')
const cred = await rpc('credentials.set', { ref: 'DEEPSEEK_API_KEY', value: 'x' }, alice)
assert(cred.json.result?.ok === false, JSON.stringify(cred.json))
assert(cred.json.result.error.code === 'unauthorized', JSON.stringify(cred.json.result.error))
console.log('   OK')

console.log('\nAll multi-user smoke checks passed.')
