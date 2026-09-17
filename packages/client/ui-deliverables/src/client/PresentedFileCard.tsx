/** File identity and explicit default-app, file-manager, and optional download actions. */
import { useRef, useState } from 'react'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import {
  Menu, FileTypeIcon, fileExtension, IconRightUpOutline16,
  IconChevronDownOutline14, IconFolderOpenOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PresentedAction, PresentedHost } from '../presented.ts'
import type { ArchivedDownloadPhase } from './archive-download.ts'
import type { PresentedOpenPhase } from './present-open.ts'
import { basename, type ArchivedPath, type PresentedPath } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './Deliverables.module.css'

function cardDescription(description: string | undefined, fallback: string): string {
  const trimmed = description?.replace(/\s*(?:\([^()]*\)|（[^（）]*）)\s*$/u, '').trim()
  return trimmed === undefined || trimmed === '' ? fallback : trimmed
}

/**
 * Render independent file actions without nesting buttons inside a clickable card.
 * @param props - durable file metadata, optional archive download, Sidebar preview, Host capabilities, gesture status, and localized copy.
 * @returns the file card and its anchored action menu.
 */
export function PresentedFileCard({
  file, cwd, phase, host, archive, downloadPhase, onPreview, onAction, onDownload, t,
}: {
  file: PresentedPath
  cwd: string | undefined
  phase: PresentedOpenPhase | undefined
  host: PresentedHost | null
  archive?: ArchivedPath
  downloadPhase?: ArchivedDownloadPhase
  onPreview: () => void
  onAction: (action: PresentedAction) => void
  onDownload?: () => void
} & PropsLocale<typeof NS>) {
  const [menuOpen, setMenuOpen] = useState(false)
  const previewRef = useRef<HTMLButtonElement>(null)
  const openPending = phase === 'opening' || phase === 'revealing'
  const downloadPending = downloadPhase === 'downloading'
  const menuDisabled = openPending || host === null || !host.available
  if (menuDisabled && menuOpen) setMenuOpen(false)
  const reveal = host?.fileManager ?? 'directory'
  const act = (action: PresentedAction) => {
    setMenuOpen(false)
    previewRef.current?.focus()
    onAction(action)
  }
  const name = basename(file.path)
  const metadata = fileExtension(name).toUpperCase() || t('presented.file')
  const idleDescription = cardDescription(file.description ?? archive?.description, metadata)
  const idleStatus = archive === undefined
    ? idleDescription
    : `${idleDescription} · ${t('archived.bytes', { bytes: String(archive.attachment.bytes) })}`
  const openStatus = phase === undefined
    ? undefined
    : t(reveal === 'directory' && phase === 'revealed' ? 'presented.directoryOpened'
      : reveal === 'directory' && phase === 'revealing' ? 'presented.directoryOpening'
        : reveal === 'directory' && phase === 'revealError' ? 'presented.directoryError' : `presented.${phase}`)
  const downloadStatus = downloadPhase === undefined ? undefined : t(`archived.${downloadPhase}`)
  const status = downloadStatus ?? openStatus ?? idleStatus
  const statusError = phase === 'error' || phase === 'revealError' || phase === 'nativeUnavailable'
    || downloadPhase === 'error'
  return <div className={css.file} data-presented-file data-has-download={archive === undefined ? undefined : true}>
    <button type="button" className={css.cardPreview} title={resolveWorkspacePath(cwd, file.path)}
      aria-label={t('presented.previewCard', { name: file.path })} onClick={onPreview} />
    <span className={css.fileIcon}><FileTypeIcon path={file.path} size={20} /></span>
    <div className={css.fileBody}>
      <div className={css.details}>
        <span className={css.fileName}>{name}</span>
        <span className={css.description} role={phase === undefined && downloadPhase === undefined ? undefined : 'status'}
          data-error={statusError ? true : undefined}>
          <span className={css.secondaryText}>{status}</span>
          <span className={css.previewHint}>{t('presented.preview')}</span>
        </span>
      </div>
      <div className={css.split}>
        <button ref={previewRef} type="button" className={css.open}
          aria-label={t('presented.previewButton', { name: file.path })}
          onClick={onPreview}>{t('presented.action')}</button>
        {archive !== undefined && onDownload !== undefined && <button type="button"
          className={`${css.open} ${css.download}`} disabled={downloadPending}
          aria-label={t('archived.downloadButton', { name: file.path })}
          onClick={onDownload}>{t('archived.download')}</button>}
        <Menu className={css.menuAnchor} open={menuOpen && !menuDisabled} autoFocus portal align="end" onClose={() => { setMenuOpen(false) }}
          anchor={<button type="button" className={css.chevron} disabled={menuDisabled}
            aria-haspopup="menu" aria-expanded={menuOpen && !menuDisabled}
            aria-label={t('presented.more', { name: file.path })}
            onClick={() => { setMenuOpen(value => !value) }}>
            <IconChevronDownOutline14 size={11} />
          </button>}
          items={[
            { id: 'open', icon: <IconRightUpOutline16 size={16} className={css.menuActionIcon} />,
              label: t('presented.defaultApp') },
            { id: 'reveal', icon: <IconFolderOpenOutline16 />,
              label: t(`presented.${reveal}`) },
          ]}
          onSelect={(id) => { act(id === 'reveal' ? 'reveal' : 'open') }} />
      </div>
    </div>
  </div>
}
