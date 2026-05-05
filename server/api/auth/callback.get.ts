export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const code = typeof query.code === 'string' ? query.code : ''
  const state = typeof query.state === 'string' ? query.state : ''
  const savedState = getLoginState(event)
  clearLoginState(event)

  if (!code) {
    throw createError({ statusCode: 400, statusMessage: 'Missing login code' })
  }

  if (savedState?.nonce && savedState.nonce !== state) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid login state' })
  }

  const config = useRuntimeConfig()
  if (!config.zrClientId || !config.zrClientSecret) {
    throw createError({ statusCode: 500, statusMessage: 'ZR login credentials are not configured' })
  }

  const response = await $fetch<any>(new URL('/api/service-auth/token', config.zrPortalUrl).toString(), {
    method: 'POST',
    body: {
      clientId: config.zrClientId,
      clientSecret: config.zrClientSecret,
      code
    }
  }).catch((error: any) => {
    throw createError({
      statusCode: 502,
      statusMessage: error?.data?.message || error?.message || 'Failed to exchange login code'
    })
  })

  const user = normalizePortalUser(response)
  setUserSession(event, user)
  return sendRedirect(event, typeof savedState?.next === 'string' ? savedState.next : '/')
})

function normalizePortalUser(response: any) {
  const source = response?.data?.user || response?.user || response?.data || response || {}
  const id = String(source.id || source.userId || source.account || source.username || source.email || 'portal-user')
  const name = String(source.name || source.userName || source.nickname || source.username || source.account || '已登录用户')

  return {
    id,
    name,
    account: source.account || source.userAccount || null,
    email: source.email || null,
    avatar: source.avatar || source.avatarUrl || null,
    raw: response
  }
}
