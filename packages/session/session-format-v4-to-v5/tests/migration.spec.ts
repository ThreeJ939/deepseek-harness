import { describe, expect, it } from 'vitest'
import { SessionFormatEventCollector } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatHeader, SessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import {
  assertReleasedV5Header,
  releasedV5SessionFormatCodec,
  restoreReleasedV5Artifact,
  sessionFormatV4ToV5,
} from '../src/index.ts'

const header: SessionFormatHeader = {
  version: 4, id: 'identity', createdAt: 1, isSeeded: false, delegationDepth: 0,
}
const fact: SessionFormatEvent = { type: 'feedback/record', seq: 0, time: 2, data: { text: 'retained' } }
const seed: SessionFormatEvent = { type: 'session/end-seed', seq: 1, time: 3, data: { inherited: true } }
const types = new Set(['feedback/record', 'session/end-seed', 'session-log-deepseek/delivery-accepted'])
const delivery = (version: number | undefined, sessionId = header.id): SessionFormatEvent => ({
  type: 'session-log-deepseek/delivery-accepted', seq: 1, time: 3,
  data: { sessionId, throughSeq: 0, ...(version === undefined ? {} : { sessionFormatVersion: version }) },
})

function stage(sourceHeader = header, sourceInheritedEventCount?: number) {
  return sessionFormatV4ToV5.createStage({
    sourceHeader,
    targetHeader: sessionFormatV4ToV5.migrateHeader(sourceHeader),
    sourceInheritedEventCount,
    sourceKind: 'decoded',
  })
}

function migrate(events: readonly SessionFormatEvent[], sourceHeader = header, cut?: number) {
  const current = stage(sourceHeader, cut)
  const output = new SessionFormatEventCollector()
  for (const event of events) current.transformEvent(event, output)
  return { events: output.values, cut: current.finish(output) }
}

describe('V4 to V5 near-identity migration', () => {
  it('changes only the header version and retains event objects and cuts', () => {
    const rows = [fact, delivery(4)]
    const before = JSON.stringify({ header, rows })
    expect(sessionFormatV4ToV5.migrateHeader(header)).toEqual({ ...header, version: 5 })
    expect(migrate(rows)).toEqual({ events: rows, cut: 0 })
    expect(migrate(rows).events[0]).toBe(fact)
    expect(JSON.stringify({ header, rows })).toBe(before)
    expect(stage().headerInheritedEventCount).toBe(0)
    expect(migrate([])).toEqual({ events: [], cut: 0 })
  })

  it('preserves optional ownerUserId only on native V5 headers', () => {
    expect(() => sessionFormatV4ToV5.migrateHeader({ ...header, ownerUserId: 'user-1' } as SessionFormatHeader))
      .toThrow(/unexpected field ownerUserId/)
    const target = { ...header, version: 5, ownerUserId: 'user-1' }
    expect(() => { assertReleasedV5Header(target) }).not.toThrow()
    expect(() => { assertReleasedV5Header({ ...target, ownerUserId: '' }) }).toThrow(/must not be empty/)
    expect(() => { assertReleasedV5Header({ ...target, ownerUserId: 7 }) }).toThrow(/must be a string/)
  })

  it('derives inherited cuts without rewriting seed markers', () => {
    const seeded = { ...header, isSeeded: true, parentSession: 'ancestor' }
    expect(stage(seeded).headerInheritedEventCount).toBeUndefined()
    expect(migrate([fact, seed], seeded, 1)).toEqual({ events: [fact, seed], cut: 1 })
    expect(() => migrate([fact, seed])).toThrow('unseeded')
    expect(() => migrate([fact], seeded)).toThrow('inherited event count')
    expect(() => migrate([fact, seed], seeded, 0)).toThrow('disagrees')
  })

  it('consumes compact runs without changing event values', () => {
    const current = stage()
    const output = new SessionFormatEventCollector()
    current.transformRun({ runType: 'identity', eventCount: 1, firstSeq: 0, *expand() { yield fact } }, output)
    expect(current.finish(output)).toBe(0)
    expect(output.values[0]).toBe(fact)
  })

  it('rejects sparse sequences and target-generation delivery claims', () => {
    expect(() => migrate([{ ...fact, seq: 1 }])).toThrow('dense')
    expect(() => migrate([fact, delivery(5)])).toThrow('claims target format v5')
  })
})

describe('V5 framing and restoration', () => {
  it('round trips headers with and without ownerUserId', () => {
    for (const current of [header, { ...header, ownerUserId: 'owner-a' }]) {
      const v5 = { ...current, version: 5 }
      const physical = releasedV5SessionFormatCodec.encodeHeader(v5, 0)
      expect(physical).toEqual({ type: 'session', ...v5 })
      expect(releasedV5SessionFormatCodec.decodeHeader(physical)).toEqual(v5)
      const decoder = releasedV5SessionFormatCodec.createDecoder(physical, 'strict')
      const output = new SessionFormatEventCollector()
      decoder.decodeRow(releasedV5SessionFormatCodec.encodeEvent(fact), output)
      expect(decoder.finish(output)).toBe(0)
      expect(output.values).toEqual([fact])
      expect(restoreReleasedV5Artifact({
        header: v5, events: output.values, inheritedEventCount: 0,
      }, types)).toMatchObject({ header: v5, events: [fact] })
    }
  })

  it('rejects mismatched versions and malformed ownerUserId', () => {
    expect(() => { assertReleasedV5Header({ ...header, version: 4 }) }).toThrow('v5 header')
    expect(() => releasedV5SessionFormatCodec.decodeHeader(null)).toThrow('v5 physical')
    expect(() => releasedV5SessionFormatCodec.createDecoder({ ...header, version: 4 }, 'strict'))
      .toThrow('v5 physical')
    expect(() => releasedV5SessionFormatCodec.decodeHeader({
      type: 'session', ...header, version: 5, ownerUserId: 7,
    })).toThrow(/ownerUserId must be a string/)
  })

  it('activates only current-generation V5 delivery markers', () => {
    const v5 = { ...header, version: 5 }
    const restore = (events: readonly SessionFormatEvent[]) => restoreReleasedV5Artifact({
      header: v5, events, inheritedEventCount: 0,
    }, types)
    for (const version of [undefined, 0, 1, 2, 3, 4]) {
      const marker = {
        ...delivery(version, 'foreign'),
        data: { ...delivery(version).data as SessionFormatJsonObject, sessionId: 'foreign', throughSeq: 500 },
      }
      expect(restore([fact, marker]).events[1]).toBe(marker)
    }
    expect(restore([fact, delivery(5)]).events[1]).toEqual(delivery(5))
    expect(() => restore([fact, delivery(5, 'foreign')])).toThrow('wrong Session')
  })
})
