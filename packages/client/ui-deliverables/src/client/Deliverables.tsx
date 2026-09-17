/** Existing changed-file chips and explicitly declared files for a closing turn. */
import { useEffect, useState } from 'react'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { Button, IconChevronDownOutline14, IconChevronUpOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GlobalStandardProps, InjectFace, PropsLocale, SessionStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { archivedFileUrl } from '../archived.ts'
import { presentedFileUrl } from '../presented.ts'
import type { ArchivedDownloadController } from './archive-download.ts'
import { ArchivedFileCard } from './ArchivedFileCard.tsx'
import type { PresentedOpenController } from './present-open.ts'
import { PresentedFileCard } from './PresentedFileCard.tsx'
import { ProducedFiles } from './ProducedFiles.tsx'
import {
  archivedForClosing, presentedForClosing, selectProducedFiles,
  type ArchivedPath, type PresentedPath,
} from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './Deliverables.module.css'

interface DeliverablesMatch {
  produced: readonly string[]
  presented: readonly PresentedPath[]
  archived: readonly ArchivedPath[]
}

/** One presented file with an optional same-path archive for a combined card. */
export interface PairedDeliverable {
  readonly presented: PresentedPath
  readonly archived?: ArchivedPath
}

const COLLAPSED_PRESENTED_COUNT = 4

/** Native-open and archive-download callbacks supplied by the plugin. */
export interface DeliverablesInjected {
  hooks: {
    presentedOpen: ObservableSnapshot<ReturnType<PresentedOpenController['state']['getSnapshot']>>
    presentedHost: ObservableSnapshot<ReturnType<PresentedOpenController['host']['getSnapshot']>>
    archivedDownload: ObservableSnapshot<ReturnType<ArchivedDownloadController['state']['getSnapshot']>>
  }
  reloadPresentedHost: PresentedOpenController['loadHost']
  openPresented: PresentedOpenController['open']
  downloadArchived: ArchivedDownloadController['download']
}

/**
 * Pair presented files with same-path archives; leftovers stay archive-only cards.
 * @param presented - closing-turn presented files.
 * @param archived - closing-turn archived files.
 * @returns combined cards plus archives without a matching present.
 */
export function pairDeliverables(
  presented: readonly PresentedPath[],
  archived: readonly ArchivedPath[],
): { paired: readonly PairedDeliverable[]; archiveOnly: readonly ArchivedPath[] } {
  const byPath = new Map<string, ArchivedPath>()
  for (const file of archived) byPath.set(file.path, file)
  const used = new Set<string>()
  const paired = presented.map((file) => {
    const match = byPath.get(file.path)
    if (match !== undefined) used.add(file.path)
    return match === undefined ? { presented: file } : { presented: file, archived: match }
  })
  return {
    paired,
    archiveOnly: archived.filter(file => !used.has(file.path)),
  }
}

/**
 * Claim turns containing modified paths, declared files, or archives.
 * @param owner - closing turn.
 * @returns matched files, or null for an empty turn.
 */
export function selectDeliverables(owner: TurnTailOwnerProps): DeliverablesMatch | null {
  const produced = selectProducedFiles(owner) ?? []
  const presented = presentedForClosing(owner)
  const archived = archivedForClosing(owner)
  return produced.length + presented.length + archived.length === 0
    ? null
    : { produced, presented, archived }
}

/**
 * Render workspace file actions, default-application buttons, and archive downloads.
 * @param props - matched files, workspace opener, and localized copy.
 * @returns the closing turn's file rows.
 */
export function Deliverables({
  matched, openFile, t, sessionId, useSessions, openPresented, downloadArchived,
  usePresentedOpen, usePresentedHost, useArchivedDownload, reloadPresentedHost,
}: Pick<TurnTailOwnerProps, 'openFile'> & {
  matched: DeliverablesMatch
} & PropsLocale<typeof NS> & Pick<SessionStandardProps, 'sessionId'> & Pick<GlobalStandardProps, 'useSessions'> & InjectFace<DeliverablesInjected>) {
  const [expanded, setExpanded] = useState(false)
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const states = usePresentedOpen(value => value)
  const host = usePresentedHost(value => value)
  const downloads = useArchivedDownload(value => value)
  const { paired, archiveOnly } = pairDeliverables(matched.presented, matched.archived)
  const collapsible = paired.length > COLLAPSED_PRESENTED_COUNT
  const visiblePaired = collapsible && !expanded
    ? paired.slice(0, COLLAPSED_PRESENTED_COUNT)
    : paired
  useEffect(() => {
    if (paired.length > 0 && host === null) void reloadPresentedHost()
  }, [paired.length, host, reloadPresentedHost])
  const afterProduced = matched.produced.length > 0
  return <>
    {matched.produced.length > 0 && <ProducedFiles matched={matched.produced} openFile={openFile} t={t} />}
    {paired.length > 0 && <div
      className={css.root}
      data-after-produced-files={afterProduced || undefined}
    >
      {host === 'error' && <div className={css.hostStatus}>
        <span>{t('presented.hostError')}</span>
        <Button size="sm" onClick={() => { void reloadPresentedHost() }}>{t('presented.retry')}</Button>
      </div>}
      {host !== null && host !== 'error' && !host.available && <span className={css.hostStatus}>{t('presented.unavailable')}</span>}
      <div className={css.presented} data-presented-files-row data-single={paired.length === 1 ? true : undefined}>
        {visiblePaired.map(({ presented: file, archived }) => {
          const downloadPhase = archived === undefined
            ? undefined
            : downloads[archivedFileUrl(sessionId, archived.seq, archived.index)]
          return <PresentedFileCard
            key={`${file.seq}:${file.index}`} file={file} cwd={cwd}
            phase={states[presentedFileUrl(sessionId, file.seq, file.index)]}
            host={host === 'error' ? null : host}
            {...archived === undefined ? {} : {
              archive: archived,
              ...downloadPhase === undefined ? {} : { downloadPhase },
              onDownload: () => {
                void downloadArchived(sessionId, archived.seq, archived.index, archived.attachment.name)
              },
            }}
            t={t}
            onPreview={() => { openFile(file.path) }}
            onAction={(action) => { void openPresented(sessionId, file.seq, file.index, action) }} />
        })}
      </div>
      {collapsible && <button type="button" className={css.toggle}
        aria-expanded={expanded}
        aria-label={t(expanded ? 'presented.collapseAria' : 'presented.expandAria', { count: paired.length })}
        onClick={() => { setExpanded(value => !value) }}>
        <span>{t(expanded ? 'presented.collapse' : 'presented.all', { count: paired.length })}</span>
        {expanded ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
      </button>}
    </div>}
    {archiveOnly.length > 0 && <div
      className={css.root}
      data-after-produced-files={afterProduced || paired.length > 0 || undefined}
      data-archived-files-row
    >
      <div className={css.presented} data-single={archiveOnly.length === 1 ? true : undefined}>
        {archiveOnly.map(file => <ArchivedFileCard key={`archive:${file.seq}:${file.index}`} file={file}
          phase={downloads[archivedFileUrl(sessionId, file.seq, file.index)]} t={t}
          onDownload={() => {
            void downloadArchived(sessionId, file.seq, file.index, file.attachment.name)
          }} />)}
      </div>
    </div>}
  </>
}
