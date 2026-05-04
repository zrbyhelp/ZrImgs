import type { H3Event } from 'h3'
import { createError, deleteCookie, getCookie, setCookie } from 'h3'
import { hmac } from './crypto'

const USER_COOKIE = 'zr_gallery_session'
const ADMIN_COOKIE = 'zr_gallery_admin'
const LOGIN_STATE_COOKIE = 'zr_gallery_login_state'
const USER_MAX_AGE = 60 * 60 * 24 * 7
const STATE_MAX_AGE = 60 * 10

export interface GalleryUser {
  id: string
  name: string
  account?: string | null
  email?: string | null
  avatar?: string | null
  raw?: unknown
}

export interface AdminUser {
  name: string
  account?: string | null
  email?: string | null
  userId?: string
}

export function setUserSession(event: H3Event, user: GalleryUser) {
  setSignedCookie(event, USER_COOKIE, user, USER_MAX_AGE)
}

export function getUserSession(event: H3Event): GalleryUser | null {
  return getSignedCookie<GalleryUser>(event, USER_COOKIE)
}

export function requireUser(event: H3Event) {
  const user = getUserSession(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Login required' })
  }
  return user
}

export function clearUserSession(event: H3Event) {
  deleteCookie(event, USER_COOKIE, cookieDefaults())
}

export function getAdminSession(event: H3Event): AdminUser | null {
  return getAdminForUser(getUserSession(event))
}

export function clearAdminSession(event: H3Event) {
  deleteCookie(event, ADMIN_COOKIE, cookieDefaults())
}

export function requireAdmin(event: H3Event) {
  const user = requireUser(event)
  const admin = getAdminForUser(user)
  if (!admin) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }
  return admin
}

export function isAdminUser(user: GalleryUser | null | undefined) {
  return Boolean(getAdminForUser(user))
}

function getAdminForUser(user: GalleryUser | null | undefined): AdminUser | null {
  if (!user) return null

  const config = useRuntimeConfig()
  const accounts = splitRuntimeList(config.adminAccounts)
  const emails = splitRuntimeList(config.adminEmails)
  const account = (user.account || '').toLowerCase()
  const email = (user.email || '').toLowerCase()
  const matched = Boolean((account && accounts.includes(account)) || (email && emails.includes(email)))

  if (!matched) return null

  return {
    name: user.name || user.account || user.email || user.id,
    account: user.account || null,
    email: user.email || null,
    userId: user.id
  }
}

function splitRuntimeList(value: unknown) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

export function setLoginState(event: H3Event, state: Record<string, unknown>) {
  setSignedCookie(event, LOGIN_STATE_COOKIE, state, STATE_MAX_AGE)
}

export function getLoginState(event: H3Event) {
  return getSignedCookie<Record<string, unknown>>(event, LOGIN_STATE_COOKIE)
}

export function clearLoginState(event: H3Event) {
  deleteCookie(event, LOGIN_STATE_COOKIE, cookieDefaults())
}

function setSignedCookie(event: H3Event, name: string, value: unknown, maxAge: number) {
  const payload = Buffer.from(JSON.stringify({ value, exp: Date.now() + maxAge * 1000 })).toString('base64url')
  const signature = hmac(payload, getSecret())
  setCookie(event, name, `${payload}.${signature}`, { ...cookieDefaults(), maxAge })
}

function getSignedCookie<T>(event: H3Event, name: string): T | null {
  const cookie = getCookie(event, name)
  if (!cookie) return null

  const [payload, signature] = cookie.split('.')
  if (!payload || !signature) return null
  if (hmac(payload, getSecret()) !== signature) return null

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!parsed.exp || parsed.exp < Date.now()) return null
    return parsed.value as T
  } catch {
    return null
  }
}

function getSecret() {
  return useRuntimeConfig().sessionSecret
}

function cookieDefaults() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  }
}
