/** Download action for one archived attachment deliverable. */
import { FileTypeIcon, fileExtension } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ArchivedDownloadPhase } from './archive-download.ts'
import { basename, type ArchivedPath } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './Deliverables.module.css'

function cardDescription(description: string | undefined, fallback: string): string {
  const trimmed = description?.replace(/\s*(?:\([^()]*\)|（[^（）]*）)\s*$/u, '').trim()
  return trimmed === undefined || trimmed === '' ? fallback : trimmed
}

/**
 * Render one archived file with a browser download action.
 * @param props - durable archive metadata, download phase, gesture handler, and localized copy.
 * @returns the archived file card.
 */
export function ArchivedFileCard({ file, phase, onDownload, t }: {
  file: ArchivedPath
  phase: ArchivedDownloadPhase | undefined
  onDownload: () => void
} & PropsLocale<typeof NS>) {
  const pending = phase === 'downloading'
  const name = basename(file.path)
  const metadata = fileExtension(name).toUpperCase() || t('archived.file')
  const sizeLabel = t('archived.bytes', { bytes: String(file.attachment.bytes) })
  const status = phase === undefined
    ? `${cardDescription(file.description, metadata)} · ${sizeLabel}`
    : t(`archived.${phase}`)
  return <div className={css.file} data-archived-file>
    <span className={css.fileIcon}><FileTypeIcon path={file.path} size={20} /></span>
    <div className={css.fileBody}>
      <div className={css.details}>
        <span className={css.fileName}>{name}</span>
        <span className={css.description} role={phase === undefined ? undefined : 'status'}
          data-error={phase === 'error' ? true : undefined}>
          <span className={css.secondaryText}>{status}</span>
        </span>
      </div>
      <div className={css.split}>
        <button type="button" className={css.open} disabled={pending}
          aria-label={t('archived.downloadButton', { name: file.path })}
          onClick={onDownload}>{t('archived.download')}</button>
      </div>
    </div>
  </div>
}
