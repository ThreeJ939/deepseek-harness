/**
 * PostgreSQL schema ownership and durable-row validation for session persistence.
 * @module @deepseek-ai/dsh-session-persistence-pg/schema
 */

import { isAbsolute } from 'node:path'
import { SESSION_FORMAT_VERSION, SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'

/** Current physical-record schema for the PostgreSQL backend. */
export const SCHEMA_VERSION = 2

/** A materialized session's metadata and monotonic revision. */
export interface SessionRow {
  readonly id: string
  readonly owner_id: string | null
  readonly version: number
  readonly created_at: number
  readonly cwd: string | null
  readonly parent_session: string | null
  readonly seed_length: number | null
  readonly origin: 'subagent' | null
  readonly incarnation: string
  readonly revision: number
  readonly delegation_depth: number | null
  readonly agent_preset: string | null
  readonly is_owned: boolean
  readonly owner_pid: number | null
}

/**
 * One physical event row: either a single logical SessionEvent, or a packed
 * `assistant/chunk` run (`text-chunks` / `reasoning-chunks` / `tool-call-chunks`)
 * marked with `ignorable === false`.
 */
export interface EventRow {
  readonly seq: number
  readonly type: string
  readonly time: number
  readonly data: unknown
  readonly source_event_seqs: unknown
  readonly surface_op: string | null
  readonly ignorable: boolean | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

/**
 * Decode and validate one durable session row.
 * @param value - value returned by PostgreSQL.
 * @returns a validated session row.
 */
export function decodeSessionRow(value: unknown): SessionRow {
  const row = record(value, 'stored session metadata')
  const id = nonemptyStringField(row, 'id')
  const version = safeIntegerField(row, 'version')
  const cwd = nullableStringField(row, 'cwd')
  if (cwd !== null && !isAbsolute(cwd)) throw new Error('stored session cwd must be absolute')
  const parent = nullableStringField(row, 'parent_session')
  const origin = nullableStringField(row, 'origin')
  if (origin !== null && origin !== 'subagent') throw new Error('stored session origin must be subagent or null')
  const incarnation = nonemptyStringField(row, 'incarnation')
  if (!UUID.test(incarnation)) throw new Error('stored session incarnation must be a UUID')
  const ownerId = nullableStringField(row, 'owner_id')
  if (ownerId !== null && ownerId.length === 0) {
    throw new Error('stored session owner_id must not be empty')
  }
  return {
    id,
    owner_id: ownerId,
    version,
    created_at: nonnegativeSafeIntegerField(row, 'created_at'),
    cwd,
    parent_session: parent,
    seed_length: nullableNonnegativeSafeIntegerField(row, 'seed_length'),
    origin,
    delegation_depth: nullableNonnegativeSafeIntegerField(row, 'delegation_depth'),
    agent_preset: nullableStringField(row, 'agent_preset'),
    incarnation,
    revision: nonnegativeSafeIntegerField(row, 'revision'),
    is_owned: booleanField(row, 'is_owned'),
    owner_pid: nullableSafeIntegerField(row, 'owner_pid'),
  }
}

/**
 * Decode and validate one durable event row before SessionEvent assembly.
 * @param value - value returned by PostgreSQL.
 * @returns a validated physical event row.
 */
export function decodeEventRow(value: unknown): EventRow {
  const row = record(value, 'stored event')
  const ignorable = nullableBooleanField(row, 'ignorable')
  return {
    seq: nonnegativeSafeIntegerField(row, 'seq'),
    type: nonemptyStringField(row, 'type'),
    time: safeIntegerField(row, 'time'),
    data: row['data'],
    source_event_seqs: row['source_event_seqs'] ?? null,
    surface_op: nullableStringField(row, 'surface_op'),
    ignorable,
  }
}

/**
 * Validate the singleton identity read from durable storage.
 * @param value - value returned by PostgreSQL.
 * @returns the UUID store identity.
 */
export function decodeStoreIdentity(value: unknown): string {
  const identity = nonemptyStringField(value, 'store_id')
  if (!UUID.test(identity)) throw new Error('stored store_id must be a UUID')
  return identity
}

/**
 * Reconstruct an immutable session header from a validated metadata row.
 * @param row - validated stored metadata row.
 * @returns the session header.
 */
export function rowToMeta(row: SessionRow): SessionHeader {
  return {
    version: row.version as typeof SESSION_FORMAT_VERSION,
    id: SessionId(row.id),
    createdAt: row.created_at,
    isSeeded: row.seed_length !== null,
    ...row.owner_id === null ? {} : { ownerUserId: row.owner_id },
    ...row.cwd === null ? {} : { cwd: row.cwd },
    ...row.parent_session === null ? {} : { parentSession: SessionId(row.parent_session) },
    ...row.origin === null ? {} : { origin: row.origin },
    ...row.delegation_depth === null ? {} : { delegationDepth: row.delegation_depth },
    ...row.agent_preset === null ? {} : { agentPreset: row.agent_preset },
  }
}

/**
 * Encode a logical `surfaceOp` for the TEXT `surface_op` column.
 * Matches SQLite: JSON text so replace objects survive the round trip.
 * @param surfaceOp - logical surface operation, or undefined when absent.
 * @returns JSON text for the column, or null when the event has no marker.
 */
export function encodeSurfaceOp(surfaceOp: unknown): string | null {
  return surfaceOp === undefined ? null : JSON.stringify(surfaceOp)
}

/**
 * Decode a stored `surface_op` TEXT value into the logical marker.
 * Accepts current JSON encoding and the legacy bare `append` literal written
 * before this column used JSON text.
 * @param surfaceOp - column value, or null when absent.
 * @returns the logical surface operation, or undefined when the column is null.
 */
export function decodeSurfaceOp(surfaceOp: string | null): unknown {
  if (surfaceOp === null) return undefined
  try {
    return JSON.parse(surfaceOp) as unknown
  } catch (error: unknown) {
    // Pre-fix rows stored the append token without JSON quotes.
    if (surfaceOp === 'append') return 'append'
    throw error instanceof Error
      ? error
      : new Error(`stored surface_op is not valid JSON: ${String(error)}`)
  }
}

/**
 * Convert a physical event row into a SessionEvent-shaped record for adoption.
 * @param row - validated event row.
 * @returns a plain event object ready for `validateStoredEvents`.
 */
export function eventRowToEvent(row: EventRow): Record<string, unknown> {
  const surfaceOp = decodeSurfaceOp(row.surface_op)
  return {
    type: row.type,
    seq: row.seq,
    time: row.time,
    data: row.data,
    ...row.source_event_seqs === null ? {} : { sourceEventSeqs: row.source_event_seqs },
    ...surfaceOp === undefined ? {} : { surfaceOp },
    ...row.ignorable ? { ignorable: true } : {},
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function stringField(value: unknown, key: string): string {
  const field = record(value, 'PostgreSQL row')[key]
  if (typeof field !== 'string') throw new Error(`stored ${key} must be a string`)
  return field
}

function nonemptyStringField(value: unknown, key: string): string {
  const field = stringField(value, key)
  if (field.length === 0) throw new Error(`stored ${key} must not be empty`)
  return field
}

function nullableStringField(value: unknown, key: string): string | null {
  const field = record(value, 'PostgreSQL row')[key]
  if (field === null || field === undefined) return null
  if (typeof field !== 'string') throw new Error(`stored ${key} must be a string or null`)
  return field
}

function coerceInteger(field: unknown, key: string): number {
  if (typeof field === 'string' && /^-?\d+$/u.test(field)) {
    const parsed = Number(field)
    if (Number.isSafeInteger(parsed)) return parsed
  }
  if (!Number.isSafeInteger(field)) throw new Error(`stored ${key} must be a safe integer`)
  return field as number
}

function safeIntegerField(value: unknown, key: string): number {
  return coerceInteger(record(value, 'PostgreSQL row')[key], key)
}

function nonnegativeSafeIntegerField(value: unknown, key: string): number {
  const field = safeIntegerField(value, key)
  if (field < 0) throw new Error(`stored ${key} must be non-negative`)
  return field
}

function nullableSafeIntegerField(value: unknown, key: string): number | null {
  const field = record(value, 'PostgreSQL row')[key]
  if (field === null || field === undefined) return null
  return coerceInteger(field, key)
}

function nullableNonnegativeSafeIntegerField(value: unknown, key: string): number | null {
  const field = nullableSafeIntegerField(value, key)
  if (field !== null && field < 0) throw new Error(`stored ${key} must be non-negative or null`)
  return field
}

function booleanField(value: unknown, key: string): boolean {
  const field = record(value, 'PostgreSQL row')[key]
  if (typeof field !== 'boolean') throw new Error(`stored ${key} must be a boolean`)
  return field
}

function nullableBooleanField(value: unknown, key: string): boolean | null {
  const field = record(value, 'PostgreSQL row')[key]
  if (field === null || field === undefined) return null
  if (typeof field !== 'boolean') throw new Error(`stored ${key} must be a boolean or null`)
  return field
}
