import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="./manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: '智枢2.0',
    short_name: '智枢',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [{
      src: '/zhishu-icon.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any',
    }],
  })
})

it('ships the product favicon mark', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'zhishu-icon.svg'), 'utf8')
  expect(favicon).toContain('<svg')
  expect(favicon.length).toBeGreaterThan(100)
})
