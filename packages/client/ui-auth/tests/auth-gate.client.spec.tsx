// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DSH_AUTH_JWT_KEY,
  notifyAuthExpired,
} from '../src/client/auth-session.ts'
import { AuthGate } from '../src/client/AuthGate.tsx'
import { en } from '../src/client/locales.ts'

const t = (key: keyof typeof en): string => en[key]

function mintJwt(exp: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const payload = btoa(JSON.stringify({ sub: 'alice', exp }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${header}.${payload}.sig`
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  document.getElementById('root')?.removeAttribute('inert')
  vi.unstubAllGlobals()
})

describe('AuthGate', () => {
  it('shows a non-dismissible login dialog and locks the app root', () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.append(root)

    render(<AuthGate config={{ allowJwtPaste: true }} t={t} />)

    const dialog = screen.getByRole('dialog', { name: en['modal.title'] })
    expect(dialog).toBeDefined()
    expect(screen.getByText(en['modal.description'])).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    expect(root.inert).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(dialog).toBeDefined()

    root.remove()
  })

  it('stores JWT and reloads after paste login', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })

    render(<AuthGate config={{ allowJwtPaste: true }} t={t} />)

    const textarea = screen.getByLabelText(en.pasteLabel)
    fireEvent.change(textarea, { target: { value: 'fixture-jwt' } })
    fireEvent.click(screen.getByRole('button', { name: en.pasteSubmit }))

    expect(sessionStorage.getItem(DSH_AUTH_JWT_KEY)).toBe('fixture-jwt')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('renders nothing when a JWT is already stored', () => {
    sessionStorage.setItem(DSH_AUTH_JWT_KEY, mintJwt(Math.floor(Date.now() / 1000) + 3600))
    const { container } = render(<AuthGate config={{ allowJwtPaste: true }} t={t} />)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reopens the login dialog when auth expires', () => {
    sessionStorage.setItem(DSH_AUTH_JWT_KEY, mintJwt(Math.floor(Date.now() / 1000) + 3600))
    const view = render(<AuthGate config={{ allowJwtPaste: true }} t={t} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    notifyAuthExpired()
    view.rerender(<AuthGate config={{ allowJwtPaste: true }} t={t} />)

    expect(screen.getByRole('dialog', { name: en['modal.title'] })).toBeDefined()
  })

  it('does not open when only an expired JWT is stored on first paint', () => {
    sessionStorage.setItem(DSH_AUTH_JWT_KEY, mintJwt(Math.floor(Date.now() / 1000) - 60))
    render(<AuthGate config={{ allowJwtPaste: true }} t={t} />)
    expect(screen.getByRole('dialog', { name: en['modal.title'] })).toBeDefined()
    expect(sessionStorage.getItem(DSH_AUTH_JWT_KEY)).toBeNull()
  })
})
