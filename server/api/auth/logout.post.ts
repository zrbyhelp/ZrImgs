export default defineEventHandler((event) => {
  clearUserSession(event)
  clearAdminSession(event)
  return { ok: true, logoutUrl: isLocalAuthBypassEnabled() ? '/' : 'https://zrg.zrbyhelp.com/' }
})
