import { describe, expect, it } from 'vitest'
import {
  decodeEventRow,
  decodeSessionRow,
  decodeStoreIdentity,
  eventRowToEvent,
  rowToMeta,
} from '../src/schema.ts'
import { sql } from '../src/sql.ts'

describe('session-persistence-pg schema helpers', () => {
  it('loads the schema SQL resource', () => {
    expect(sql('schema')).toContain('CREATE TABLE IF NOT EXISTS sessions')
    expect(sql('schema')).toBe(sql('schema'))
  })

  it('decodes a minimal session row and rebuilds the header', () => {
    const row = decodeSessionRow({
      id: 's1',
      owner_id: 'u1',
      version: 0,
      created_at: 10,
      cwd: '/tmp/ws',
      parent_session: null,
      seed_length: null,
      origin: null,
      incarnation: '11111111-1111-4111-8111-111111111111',
      revision: 2,
      delegation_depth: null,
      agent_preset: null,
      is_owned: false,
      owner_pid: null,
    })
    expect(rowToMeta(row)).toMatchObject({ id: 's1', ownerUserId: 'u1', cwd: '/tmp/ws', isSeeded: false })
  })

  it('decodes seeded subagent metadata', () => {
    const row = decodeSessionRow({
      id: 'child',
      owner_id: null,
      version: 0,
      created_at: 1,
      cwd: null,
      parent_session: 'parent',
      seed_length: 3,
      origin: 'subagent',
      incarnation: '22222222-2222-4222-8222-222222222222',
      revision: 0,
      delegation_depth: 1,
      agent_preset: 'explore',
      is_owned: true,
      owner_pid: 42,
    })
    expect(rowToMeta(row)).toMatchObject({
      isSeeded: true,
      parentSession: 'parent',
      origin: 'subagent',
      delegationDepth: 1,
      agentPreset: 'explore',
    })
  })

  it('rejects invalid session rows', () => {
    expect(() => decodeSessionRow(null)).toThrow(/object/)
    expect(() => decodeSessionRow({ id: '' })).toThrow(/empty/)
    expect(() => decodeSessionRow({
      id: 's', version: 0, created_at: 1, cwd: 'relative', parent_session: null, seed_length: null,
      origin: null, incarnation: '11111111-1111-4111-8111-111111111111', revision: 0,
      owner_id: null, delegation_depth: null, agent_preset: null, is_owned: false, owner_pid: null,
    })).toThrow(/absolute/)
    expect(() => decodeSessionRow({
      id: 's', version: 0, created_at: 1, cwd: null, parent_session: null, seed_length: null,
      origin: 'other', incarnation: '11111111-1111-4111-8111-111111111111', revision: 0,
      owner_id: null, delegation_depth: null, agent_preset: null, is_owned: false, owner_pid: null,
    })).toThrow(/subagent/)
    expect(() => decodeSessionRow({
      id: 's', version: 0, created_at: 1, cwd: null, parent_session: null, seed_length: null,
      origin: null, incarnation: 'not-a-uuid', revision: 0,
      owner_id: null, delegation_depth: null, agent_preset: null, is_owned: false, owner_pid: null,
    })).toThrow(/UUID/)
    expect(() => decodeSessionRow({
      id: 's', version: 0, created_at: 1, cwd: null, parent_session: null, seed_length: null,
      origin: null, incarnation: '11111111-1111-4111-8111-111111111111', revision: 0,
      owner_id: '', delegation_depth: null, agent_preset: null, is_owned: false, owner_pid: null,
    })).toThrow(/owner_id/)
  })

  it('decodes event rows and projects SessionEvent fields', () => {
    const row = decodeEventRow({
      seq: 1,
      type: 'user/message',
      time: 2,
      data: { ok: true },
      source_event_seqs: [0],
      surface_op: 'append',
      ignorable: true,
    })
    expect(eventRowToEvent(row)).toEqual({
      type: 'user/message',
      seq: 1,
      time: 2,
      data: { ok: true },
      sourceEventSeqs: [0],
      surfaceOp: 'append',
      ignorable: true,
    })
    expect(eventRowToEvent(decodeEventRow({
      seq: 0, type: 'turn/start', time: 1, data: { turn: 1 },
      source_event_seqs: null, surface_op: null, ignorable: null,
    }))).toEqual({ type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } })
  })

  it('rejects invalid event and store identity rows', () => {
    expect(() => decodeEventRow({ seq: -1, type: 'x', time: 1, data: {}, source_event_seqs: null, surface_op: null, ignorable: null })).toThrow()
    expect(() => decodeEventRow({ seq: 0, type: 'x', time: 1, data: {}, source_event_seqs: null, surface_op: null, ignorable: 'yes' })).toThrow(/boolean/)
    expect(() => decodeStoreIdentity({ store_id: 'nope' })).toThrow(/UUID/)
    expect(decodeStoreIdentity({ store_id: '33333333-3333-4333-8333-333333333333' })).toBe('33333333-3333-4333-8333-333333333333')
  })

  it('accepts bigint-looking numeric strings from drivers', () => {
    const row = decodeSessionRow({
      id: 's',
      owner_id: null,
      version: '0',
      created_at: '100',
      cwd: null,
      parent_session: null,
      seed_length: '2',
      origin: null,
      incarnation: '44444444-4444-4444-8444-444444444444',
      revision: '7',
      delegation_depth: '0',
      agent_preset: null,
      is_owned: false,
      owner_pid: '9',
    })
    expect(row.created_at).toBe(100)
    expect(row.seed_length).toBe(2)
    expect(row.owner_pid).toBe(9)
  })
})
