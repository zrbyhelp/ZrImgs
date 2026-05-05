import { randomBytes } from 'node:crypto'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const query = getQuery(event)
  const next = typeof query.next === 'string' ? query.next : '/'

  if (isLocalAuthBypassEnabled()) {
    return sendRedirect(event, next)
  }

  if (!config.zrClientId) {
    throw createError({ statusCode: 500, statusMessage: 'ZR_CLIENT_ID is not configured' })
  }

  const nonce = randomBytes(18).toString('base64url')
  setLoginState(event, { nonce, next })

  const requestUrl = getRequestURL(event)
  const callback = config.zrCallbackUrl || `${requestUrl.origin}/api/auth/callback`
  const url = new URL('/login', config.zrPortalUrl)
  url.searchParams.set('client_id', config.zrClientId)
  url.searchParams.set('callback', callback)
  url.searchParams.set('state', nonce)

  return sendRedirect(event, url.toString())
})
