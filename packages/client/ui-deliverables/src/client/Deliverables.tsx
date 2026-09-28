/** The changed-files card, shown only while the Host serves the turn's summary, and explicitly declared files for a closing turn. */
import { useEffect, useState } from 'react'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { Button, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GlobalStandardProps, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, SessionStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { archivedFileUrl } from '../archived.ts'
import type { PresentedOpenController } from './present-open.ts'
import type { ArchivedDownloadController } from './archive-download.ts'
import type { ChangesDiffStore } from './changes-diff.ts'
import type { ChangesSummaryStore } from './changes-summary.ts'
import { ChangedFiles } from './ChangedFiles.tsx'
import { ArchivedFileCard } from './ArchivedFileCard.tsx'
import {
  archivedForClosing, changesForClosing, presentedForClosing,
  type ArchivedPath, type ChangesTurnData, type PresentedPath,
} from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import { changesSummaryUrl, type ChangesReviewCoordinates } from '../changes.ts'
import { presentedFileUrl } from '../presented.ts'
import { PresentedFileCard } from './PresentedFileCard.tsx'
import css from './Deliverables.module.css'

interface DeliverablesMatch {
  changes: ChangesTurnData | null
  presented: readonly PresentedPath[]
  /** Closing-turn archives; omitted in older test fixtures that only exercise presented/changes. */
  archived?: readonly ArchivedPath[]
}

/** One presented file with an optional same-path archive for a combined card. */
export interface PairedDeliverable {
  readonly presented: PresentedPath
  readonly archived?: ArchivedPath
}

const COLLAPSED_PRESENTED_COUNT = 4

/** Summary reads, native-open callbacks, archive downloads, and shared gesture status supplied by the plugin. */
export interface DeliverablesInjected {
  hooks: {
    changesDiff: ObservableSnapshot<ReturnType<ChangesDiffStore['state']['getSnapshot']>>
    showCodeDiff: ObservableSnapshot<boolean>
    presentedOpen: ObservableSnapshot<ReturnType<PresentedOpenController['state']['getSnapshot']>>
    presentedHost: ObservableSnapshot<ReturnType<PresentedOpenController['host']['getSnapshot']>>
    changesSummary: ObservableSnapshot<ReturnType<ChangesSummaryStore['state']['getSnapshot']>>
    archivedDownload: ObservableSnapshot<ReturnType<ArchivedDownloadController['state']['getSnapshot']>>
  }
  reloadPresentedHost: PresentedOpenController['loadHost']
  loadChangesDiff: ChangesDiffStore['load']
  loadChangesSummary: ChangesSummaryStore['load']
  openPresented: PresentedOpenController['open']
  openChanged: PresentedOpenController['openChanged']
  /** Open one turn's review in the right Sidebar on the file at an index. */
  openChangesReview: (coordinates: ChangesReviewCoordinates, index: number) => void
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
 * Claim turns with a change announcement, declared files, or archives.
 * @param owner - closing turn.
 * @returns matched announcement and deliveries, or null for a turn with neither.
 */
export function selectDeliverables(owner: TurnTailOwnerProps): DeliverablesMatch | null {
  const changes = changesForClosing(owner)
  const presented = presentedForClosing(owner)
  const archived = archivedForClosing(owner)
  return changes === null && presented.length === 0 && archived.length === 0
    ? null
    : { changes, presented, archived }
}

/**
 * Contribute file deliveries alongside other completed-Turn artifacts.
 * @param props - closing Turn, file actions, and localized copy.
 * @returns file rows, or null when the Turn declares none.
 */
export function DeliverablesTail(props: PropsRuntime<'conversation.chat.turnTail'> & PropsLocale<typeof NS> & InjectFace<DeliverablesInjected> & PropsRenderSlots<'deliverables.file.actions'>) {
  const matched = selectDeliverables(props)
  return matched === null ? null : <Deliverables {...props} matched={matched} />
}

/**
 * Render the changed-files card, once the Host has served the announced
 * summary and it lists a file, shared native opening controls for declared
 * files, and archive download cards. A summary the Host no longer serves leaves no card.
 * @param props - matched announcement and files, workspace opener, and localized copy.
 * @returns the closing turn's file rows.
 */
export function Deliverables({
  matched, openFile, t, sessionId, useSessions, openPresented, openChangesReview, downloadArchived,
  usePresentedOpen, usePresentedHost, useArchivedDownload, useChangesDiff, loadChangesDiff,
  useChangesSummary, reloadPresentedHost, loadChangesSummary, useShowCodeDiff, renderSlot,
}: Pick<TurnTailOwnerProps, 'openFile'> & {
  matched: DeliverablesMatch
} & PropsLocale<typeof NS> & Pick<SessionStandardProps, 'sessionId'> & Pick<GlobalStandardProps, 'useSessions'> & InjectFace<DeliverablesInjected> & PropsRenderSlots<'deliverables.file.actions'>) {
  const [expanded, setExpanded] = useState(false)
  const showCodeDiff = useShowCodeDiff(value => value)
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const states = usePresentedOpen(value => value)
  const host = usePresentedHost(value => value)
  const downloads = useArchivedDownload(value => value)
  const announced = showCodeDiff ? matched.changes : null
  const summary = useChangesSummary(value => announced === null ? undefined : value[changesSummaryUrl(sessionId, announced.seq)])
  useEffect(() => {
    if (announced !== null && summary === undefined) void loadChangesSummary(sessionId, announced.seq)
  }, [announced, summary, sessionId, loadChangesSummary])
  const changes = announced !== null && typeof summary === 'object' && summary.files.length > 0
    ? { seq: announced.seq, ...summary }
    : null
  const { paired, archiveOnly } = pairDeliverables(matched.presented, matched.archived ?? [])
  const collapsible = paired.length > COLLAPSED_PRESENTED_COUNT
  const visiblePaired = collapsible && !expanded
    ? paired.slice(0, COLLAPSED_PRESENTED_COUNT)
    : paired
  useEffect(() => {
    if (paired.length > 0 && host === null) void reloadPresentedHost()
  }, [paired.length, host, reloadPresentedHost])
  return <>
    {changes !== null && <ChangedFiles changes={changes} cwd={cwd} t={t}
      sessionId={sessionId} useChangesDiff={useChangesDiff} loadChangesDiff={loadChangesDiff}
      openReview={(index) => { openChangesReview({ sessionId, seq: changes.seq, turn: changes.turn }, index) }} />}
    {paired.length > 0 && <div
      className={css.root}
      data-after-changes={changes !== null || undefined}
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
          return <PresentedFileCard key={`${file.seq}:${file.index}`} file={file} cwd={cwd}
            phase={states[presentedFileUrl(sessionId, file.seq, file.index)]}
            host={host === 'error' ? null : host} t={t}
            {...archived === undefined ? {} : {
              archive: archived,
              ...downloadPhase === undefined ? {} : { downloadPhase },
              onDownload: () => {
                void downloadArchived(sessionId, archived.seq, archived.index, archived.attachment.name)
              },
            }}
            onPreview={() => { openFile(file.path) }}
            actions={renderSlot('deliverables.file.actions', {
              actionUrl: presentedFileUrl(sessionId, file.seq, file.index),
              available: host !== null && host !== 'error' && host.available,
              pending: states[presentedFileUrl(sessionId, file.seq, file.index)] === 'opening'
                || states[presentedFileUrl(sessionId, file.seq, file.index)] === 'revealing',
              onAction: (action, application) => openPresented(sessionId, file.seq, file.index, action, application),
            })} />
        })}
      </div>
      {collapsible && <button type="button" className={css.toggle}
        aria-expanded={expanded}
        aria-label={t(expanded ? 'presented.collapseAria' : 'presented.expandAria', { count: paired.length })}
        onClick={() => { setExpanded(value => !value) }}>
        <span>{t(expanded ? 'presented.collapse' : 'presented.all', { count: paired.length })}</span>
        {expanded ? <IconChevronUpOutlineRegular /> : <IconChevronDownOutlineRegular />}
      </button>}
    </div>}
    {archiveOnly.length > 0 && <div
      className={css.root}
      data-after-changes={changes !== null || paired.length > 0 || undefined}
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
