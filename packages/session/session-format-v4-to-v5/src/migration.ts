/** Near-identity V4→V5 migration: bump the header version and pass events through. */

import {
  defineSessionFormatMigration,
  SessionFormatError,
  SessionFormatUnsupportedMigrationError,
  isSessionFormatJsonObject,
  sessionFormatCount,
} from '@deepseek-ai/dsh-session-format'
import type {
  SessionFormatEvent,
  SessionFormatEventRun,
  SessionFormatMigrationContext,
  SessionFormatMigrationStage,
  SessionFormatMigrationStageInput,
} from '@deepseek-ai/dsh-session-format'
import { assertReleasedV4Header } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { assertReleasedV5Header } from './validation.ts'

/** Adjacent near-identity migration that advances V4 headers to V5. */
export const sessionFormatV4ToV5 = defineSessionFormatMigration({
  name: '@deepseek-ai/dsh-session-format-v4-to-v5',
  fromVersion: 4,
  toVersion: 5,
  migrateHeader(header) {
    assertReleasedV4Header(header)
    return { ...header, version: 5 }
  },
  createStage(input) {
    return new ReleasedV4ToV5Stage(input)
  },
  validateTargetHeader: assertReleasedV5Header,
})

class ReleasedV4ToV5Stage implements SessionFormatMigrationStage {
  readonly headerInheritedEventCount?: number
  private cut: number | undefined
  private sourceCut: number | undefined
  private nextSeq = 0

  constructor(private readonly input: SessionFormatMigrationStageInput) {
    this.cut = input.sourceHeader.isSeeded ? undefined : 0
    this.sourceCut = this.cut
    if (!input.sourceHeader.isSeeded) this.headerInheritedEventCount = 0
  }

  transformEvent(event: SessionFormatEvent, context: SessionFormatMigrationContext): void {
    if (event.seq !== this.nextSeq) throw new SessionFormatError('V4 source events must be dense')
    this.nextSeq += 1
    if (event.type === 'session/end-seed' && isSessionFormatJsonObject(event.data)
      && event.data['inherited'] === true) {
      if (!this.input.sourceHeader.isSeeded) {
        throw new SessionFormatError('unseeded format v4 Session contains an inherited end-seed marker')
      }
      this.sourceCut = event.seq
      this.cut = event.seq
    }
    if (event.type === 'session-log-deepseek/delivery-accepted'
      && isSessionFormatJsonObject(event.data)
      && event.data['sessionFormatVersion'] === 5) {
      throw new SessionFormatUnsupportedMigrationError(
        'format v4 delivery marker claims target format v5',
      )
    }
    context.emitEvent(event)
  }

  transformRun(run: SessionFormatEventRun, context: SessionFormatMigrationContext): void {
    for (const event of run.expand()) this.transformEvent(event, context)
  }

  finish(_context: SessionFormatMigrationContext): number {
    const cut = sessionFormatCount(this.cut, 'V4 inherited event count')
    const sourceCut = sessionFormatCount(this.sourceCut, 'V4 source inherited event count')
    if (this.input.sourceInheritedEventCount !== undefined
      && sourceCut !== this.input.sourceInheritedEventCount) {
      throw new SessionFormatError('format v4 inherited cut disagrees with its source marker')
    }
    return cut
  }
}
