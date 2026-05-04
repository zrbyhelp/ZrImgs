import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

export function hmac(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

export function randomToken(prefix = 'zr') {
  return `${prefix}_${randomBytes(32).toString('base64url')}`
}

export function timingSafeStringEqual(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
