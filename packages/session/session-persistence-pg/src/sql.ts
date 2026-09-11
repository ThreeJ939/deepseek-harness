/**
 * Closed, package-owned SQL resource loading for PostgreSQL session persistence.
 * @module @deepseek-ai/dsh-session-persistence-pg/sql
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SQL_RESOURCES = ['schema'] as const

/** A resource basename selected exclusively by package code. */
export type SqlResourceName = typeof SQL_RESOURCES[number]

const cache = new Map<SqlResourceName, string>()

/**
 * Load an immutable SQL statement by closed resource name.
 * @param name - package-owned resource basename.
 * @returns the resource text.
 */
export function sql(name: SqlResourceName): string {
  const cached = cache.get(name)
  if (cached !== undefined) return cached
  const statement = readFileSync(
    fileURLToPath(new URL(`../resources/sql/${name}.sql`, import.meta.url)),
    'utf8',
  )
  cache.set(name, statement)
  return statement
}
