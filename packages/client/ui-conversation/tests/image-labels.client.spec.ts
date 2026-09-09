import { describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { attachmentErrorText, imageSizeText } from '../src/client/image-labels.ts'
import { en, zh } from '../src/client/locales.ts'

const t = makeTranslate(zh, commonZh)
const enT = makeTranslate(en, commonZh)

describe('attachment rejection copy', () => {
  const limits = {
    maxImageBytes: 5 * 1024 * 1024,
    maxImagesPerMessage: 20,
    maxMessageImageBytes: 100 * 1024 * 1024,
    maxImagePixels: 40_000_000,
    maxImageDimension: 2000,
    mediaTypes: ['image/png'] as const,
  }

  it('renders megabytes without a trailing fraction unless one exists', () => {
    expect(imageSizeText(10 * 1024 * 1024)).toBe('10MB')
    expect(imageSizeText(2.5 * 1024 * 1024)).toBe('2.5MB')
  })

  it('maps user-solvable reasons to limit-naming copy', () => {
    expect(attachmentErrorText(t, 'MODEL_DOES_NOT_SUPPORT_IMAGES')).toBe('当前模型不支持图片，请切换支持图片的模型')
    expect(attachmentErrorText(t, 'IMAGE_TOO_MANY_PIXELS')).toBe('图片分辨率过大，请压缩后重试')
    expect(attachmentErrorText(t, 'INVALID_IMAGE')).toBe('仅支持 PNG、JPG、WebP、GIF、BMP 格式的图片')
    expect(attachmentErrorText(t, 'IMAGE_TYPE_MISMATCH')).toBe('仅支持 PNG、JPG、WebP、GIF、BMP 格式的图片')
    expect(attachmentErrorText(t, 'TOO_MANY_IMAGES', limits)).toBe('一条消息最多添加 20 张图片')
    expect(attachmentErrorText(t, 'IMAGE_TOO_LARGE', limits)).toBe('单张图片不能超过 5MB')
    expect(attachmentErrorText(t, 'IMAGES_TOO_LARGE', limits)).toBe('图片总大小超过 100MB，请移除部分图片')
    expect(attachmentErrorText(t, 'IMAGE_DIMENSION_TOO_LARGE', limits)).toBe('图片宽高不能超过 2000px，请缩小后重试')
    expect(attachmentErrorText(enT, 'TOO_MANY_IMAGES', limits)).toBe('A message can include up to 20 images')
  })

  it('maps document admission reasons to document copy', () => {
    const documentLimits = {
      maxDocumentBytes: 10 * 1024 * 1024,
      maxDocumentsPerMessage: 5,
      maxMessageDocumentBytes: 40 * 1024 * 1024,
      maxExtractedCharsPerDocument: 50_000,
      mediaTypes: ['text/plain'] as const,
    }
    expect(attachmentErrorText(t, 'UNSUPPORTED_DOCUMENT_TYPE')).toBe(
      '仅支持 PDF、Word、Excel、PPT、文本、JSON、Markdown、CSV、Java、SQL、EPUB 文档',
    )
    expect(attachmentErrorText(t, 'TOO_MANY_DOCUMENTS', undefined, documentLimits)).toBe(
      '一条消息最多添加 5 个文档',
    )
    expect(attachmentErrorText(t, 'DOCUMENT_TOO_LARGE', undefined, documentLimits)).toBe(
      '单个文档不能超过 10MB',
    )
    expect(attachmentErrorText(t, 'DOCUMENTS_TOO_LARGE', undefined, documentLimits)).toBe(
      '文档总大小不能超过 40MB',
    )
    expect(attachmentErrorText(t, 'DOCUMENT_EXTRACTION_FAILED')).toBe(
      '无法从该文档提取文本，请换一份可复制文字的文件后再试',
    )
  })

  it('folds unknown reasons and limit reasons without projected limits into the send-failed line', () => {
    expect(attachmentErrorText(t, 'INVALID_IMAGE_BASE64')).toBe('图片发送失败（INVALID_IMAGE_BASE64），请重新添加图片后再试')
    expect(attachmentErrorText(t, 'TOO_MANY_IMAGES')).toBe('图片发送失败（TOO_MANY_IMAGES），请重新添加图片后再试')
    expect(attachmentErrorText(t, 'IMAGE_TOO_LARGE')).toBe('图片发送失败（IMAGE_TOO_LARGE），请重新添加图片后再试')
    expect(attachmentErrorText(t, 'IMAGES_TOO_LARGE')).toBe('图片发送失败（IMAGES_TOO_LARGE），请重新添加图片后再试')
    expect(attachmentErrorText(t, 'IMAGE_DIMENSION_TOO_LARGE')).toBe('图片发送失败（IMAGE_DIMENSION_TOO_LARGE），请重新添加图片后再试')
    expect(attachmentErrorText(t, 'TOO_MANY_DOCUMENTS')).toBe(
      '文档发送失败（TOO_MANY_DOCUMENTS），请重新添加文档后再试',
    )
  })
})
