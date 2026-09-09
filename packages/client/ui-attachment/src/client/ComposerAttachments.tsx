import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ComposerAttachment, ComposerAttachmentsProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AttachmentRail } from '../AttachmentRail.tsx'
import type { AttachmentRailItem } from '../AttachmentRail.tsx'
import { DropOverlay } from '../DropOverlay.tsx'
import { ImageLightbox } from '../ImageLightbox.tsx'
import { attachmentRailLabels, dropOverlayLabels, lightboxLabels } from './labels.ts'
import css from './ComposerAttachments.module.css'

/** Rail item retaining its browser-owned attachment for callbacks. */
interface ComposerRailItem extends AttachmentRailItem {
  attachment: Extract<ComposerAttachment, { kind: 'image' }>
}

/** Draft-image rail, document chips, drop target, and original-image preview. */
export function ComposerAttachments({
  attachments, canAcceptDrop, onAddImages, onAddDocuments, onRemoveImage, dropLimits, t,
}: ComposerAttachmentsProps) {
  const [preview, setPreview] = useState<Extract<ComposerAttachment, { kind: 'image' }> | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  const closePreview = useCallback(() => { setPreview(null) }, [])

  const images = useMemo(
    () => attachments.filter(
      (attachment): attachment is Extract<ComposerAttachment, { kind: 'image' }> => attachment.kind === 'image',
    ),
    [attachments],
  )
  const documents = useMemo(
    () => attachments.filter(
      (attachment): attachment is Extract<ComposerAttachment, { kind: 'document' }> => attachment.kind === 'document',
    ),
    [attachments],
  )

  useEffect(() => {
    if (preview !== null && !images.some(attachment => attachment.id === preview.id)) setPreview(null)
  }, [images, preview])

  useEffect(() => {
    const fileTransfer = (event: globalThis.DragEvent): DataTransfer | null => {
      const dataTransfer = event.dataTransfer
      if (dataTransfer === null || !dataTransfer.types.includes('Files')) return null
      return dataTransfer
    }
    const reset = (): void => {
      dragDepth.current = 0
      setDragActive(false)
    }
    const onDragEnter = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      event.preventDefault()
      dragDepth.current += 1
      setDragActive(true)
    }
    const onDragOver = (event: globalThis.DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      dataTransfer.dropEffect = canAcceptDrop ? 'copy' : 'none'
    }
    const onDragLeave = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragActive(false)
      const leftViewport = event.clientX <= 0 || event.clientY <= 0
        || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight
      if ((event.target === document.documentElement || event.target === document.body) && leftViewport) reset()
    }
    const onDrop = (event: globalThis.DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      reset()
      if (!canAcceptDrop) return
      const files = [...dataTransfer.files]
      const imageFiles = files.filter(file => file.type.startsWith('image/'))
      const documentFiles = files.filter(file => !file.type.startsWith('image/'))
      if (imageFiles.length > 0) onAddImages(imageFiles)
      if (documentFiles.length > 0) onAddDocuments(documentFiles)
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    window.addEventListener('dragend', reset)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', reset)
    }
  }, [canAcceptDrop, onAddDocuments, onAddImages])

  const railItems = useMemo<ComposerRailItem[]>(() => images.map(attachment => ({
    id: attachment.id,
    previewUrl: attachment.previewUrl,
    alt: attachment.file.name || t('image.pending'),
    removeLabel: t('image.remove', { name: attachment.file.name }),
    attachment,
  })), [images, t])

  return (
    <>
      {dragActive && (
        <DropOverlay
          disabled={!canAcceptDrop}
          labels={dropOverlayLabels(t, canAcceptDrop, dropLimits)}
        />
      )}
      {(railItems.length > 0 || documents.length > 0) && (
        <div className={css.rail}>
          {documents.length > 0 && (
            <div className={css.documents}>
              {documents.map(attachment => (
                <div key={attachment.id} className={css.documentChip}>
                  <span className={css.documentName}>
                    {attachment.file.name || t('document.pending')}
                  </span>
                  <button
                    type="button"
                    className={css.documentRemove}
                    aria-label={t('document.remove', { name: attachment.file.name || t('document.pending') })}
                    onClick={() => { onRemoveImage(attachment.id) }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {railItems.length > 0 && (
            <AttachmentRail
              items={railItems}
              labels={attachmentRailLabels(t)}
              onOpen={(item) => { setPreview(item.attachment) }}
              onRemove={(item) => { onRemoveImage(item.attachment.id) }}
            />
          )}
        </div>
      )}
      {preview !== null && (
        <ImageLightbox
          src={preview.previewUrl}
          alt={preview.file.name || t('image.original')}
          labels={lightboxLabels(t)}
          onClose={closePreview}
        />
      )}
    </>
  )
}
