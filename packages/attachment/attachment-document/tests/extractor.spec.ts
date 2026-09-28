import { describe, expect, it } from 'vitest'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import { extractText } from '../src/extractor.ts'

describe('extractText', () => {
  it('decodes UTF-8 text documents and truncates to the character budget', async () => {
    const text = await extractText(new TextEncoder().encode('hello world'), 'text/plain', 5)
    expect(text).toBe('hello…')
  })

  it('rejects empty text payloads', async () => {
    await expect(extractText(new Uint8Array(), 'text/plain')).rejects.toMatchObject({
      name: 'AttachmentError',
      code: 'INVALID_DOCUMENT',
    })
  })

  it('rejects media types without an extractor', async () => {
    await expect(
      extractText(new TextEncoder().encode('x'), 'application/epub+zip'),
    ).rejects.toBeInstanceOf(AttachmentError)
    await expect(
      extractText(new TextEncoder().encode('x'), 'application/epub+zip'),
    ).rejects.toMatchObject({ code: 'DOCUMENT_EXTRACTION_FAILED' })
  })
})
