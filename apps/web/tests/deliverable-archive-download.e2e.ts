/** Authored archive + present turn: Download only on archived attachments. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureExpandedTurnProcessAria,
  compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, seedSession, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const DIR = fileURLToPath(new URL('../../../snapshots/web/deliverable-archive-download', import.meta.url))
const FIXTURE = join(DIR, 'session.v3.jsonl')
const UI_EXPECTED = join(DIR, 'ui.expected.md')
const MODE = webSnapshotMode()
const SEED_ID = 'deliverable-archive-download-web-e2e'
const DONE = 'ARCHIVE_DOWNLOAD_DONE'
const PRESENTED_ONLY = 'presented-only.txt'
const ARCHIVED = 'archived-report.txt'
const PRESENTED_TEXT = 'PRESENTED_ONLY\n'
const ARCHIVED_TEXT = 'ARCHIVED_BYTES\n'
const PROMPT = 'Write presented-only.txt and archived-report.txt, call present for both, '
  + 'then archive_deliverable only for archived-report.txt. Finish with ARCHIVE_DOWNLOAD_DONE.'

describe.skipIf(MODE === 'record')('web e2e: archived deliverable download', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    const fixture = await readFile(FIXTURE, 'utf8')
    expect(fixtureUserPrompts(fixture)).toEqual([PROMPT])
    scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('./deliverable-archive-download.overlay.yml', import.meta.url)),
    })
    await writeFile(join(scaffold.workspaceCwd, PRESENTED_ONLY), PRESENTED_TEXT)
    await writeFile(join(scaffold.workspaceCwd, ARCHIVED), ARCHIVED_TEXT)
    const attachment = await scaffold.ctx.attachments.saveFile({
      data: Buffer.from(ARCHIVED_TEXT),
      name: ARCHIVED,
    })
    expect(String(attachment.attachmentId)).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(attachment.bytes).toBe(Buffer.byteLength(ARCHIVED_TEXT))
    expect(fixture).toContain(String(attachment.attachmentId))
    await seedSession(scaffold, fixture, SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows Download only for the archived file and streams its bytes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-deliverable-archive-download'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await expect.poll(() => page.getByText(DONE, { exact: true }).count(), { timeout: 15_000 }).toBe(1)

    await expect.poll(() => page.locator('[data-presented-file]').count()).toBe(2)
    expect(await page.locator('[data-presented-file]')
      .getByRole('button', { name: /^Download/ }).count()).toBe(0)

    const archived = page.locator('[data-archived-file]')
    await expect.poll(() => archived.count()).toBe(1)
    expect(await archived.filter({ hasText: ARCHIVED }).count()).toBe(1)
    expect(await page.locator('[data-archived-file]').filter({ hasText: PRESENTED_ONLY }).count()).toBe(0)

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
    await archived.getByRole('button', { name: `Download ${ARCHIVED}` }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe(ARCHIVED)
    expect(await readFile(await download.path(), 'utf8')).toBe(ARCHIVED_TEXT)
    await expect.poll(() => page.getByText('Download started', { exact: true }).count()).toBe(1)

    const aria = await captureExpandedTurnProcessAria(page, '[data-chat-flow]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, aria, MODE === 'refresh' ? 'refresh' : 'replay')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(DIR, [
      'session.v3.jsonl',
      'ui.expected.md',
    ])
  })
})
