/** V5 framing reuses released V4 row admission with optional ownerUserId headers. */

import { SessionFormatError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type {
  SessionFormatCodec,
  SessionFormatCurrentEncoder,
  SessionFormatEvent,
  SessionFormatHeader,
  SessionFormatJsonObject,
} from '@deepseek-ai/dsh-session-format'
import { releasedV4SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { assertReleasedV5Header } from './validation.ts'

function withoutOwnerUserId(header: SessionFormatJsonObject): SessionFormatJsonObject {
  const { ownerUserId: _ownerUserId, ...rest } = header
  return rest
}

function physicalV4(value: unknown): SessionFormatHeader {
  if (!isSessionFormatJsonObject(value) || value['version'] !== 5) {
    throw new SessionFormatError('expected format v5 physical header')
  }
  return { ...withoutOwnerUserId(value as SessionFormatJsonObject), version: 4 } as SessionFormatHeader
}

function restoreOwnerUserId(
  header: SessionFormatHeader,
  physical: SessionFormatJsonObject,
): SessionFormatHeader {
  const ownerUserId = physical['ownerUserId']
  if (ownerUserId === undefined) return { ...header, version: 5 }
  if (typeof ownerUserId !== 'string') {
    throw new SessionFormatError('format v5 header ownerUserId must be a string')
  }
  return { ...header, version: 5, ownerUserId }
}

/**
 * V5 physical encoder and decoder retain released V4 row framing while
 * admitting the optional `ownerUserId` header field.
 */
export const releasedV5SessionFormatCodec = Object.freeze({
  version: 5,
  decodeHeader(value: unknown) {
    if (!isSessionFormatJsonObject(value)) {
      throw new SessionFormatError('expected format v5 physical header')
    }
    return restoreOwnerUserId(releasedV4SessionFormatCodec.decodeHeader(physicalV4(value)), value as SessionFormatJsonObject)
  },
  createDecoder(value, recovery) {
    if (!isSessionFormatJsonObject(value)) {
      throw new SessionFormatError('expected format v5 physical header')
    }
    const decoder = releasedV4SessionFormatCodec.createDecoder(physicalV4(value), recovery)
    return {
      ...decoder,
      header: restoreOwnerUserId(decoder.header, value as SessionFormatJsonObject),
    }
  },
  encodeHeader(header, inheritedEventCount) {
    assertReleasedV5Header(header)
    const { ownerUserId, ...rest } = header
    return {
      ...releasedV4SessionFormatCodec.encodeHeader({ ...rest, version: 4 }, inheritedEventCount),
      version: 5,
      ...(ownerUserId === undefined ? {} : { ownerUserId }),
    }
  },
  encodeEvent(event: SessionFormatEvent) {
    return releasedV4SessionFormatCodec.encodeEvent(event)
  },
} satisfies SessionFormatCodec & SessionFormatCurrentEncoder)
