export default defineEventHandler((event) => {
  clearUserSession(event)
  clearAdminSession(event)
  return sendRedirect(event, isLocalAuthBypassEnabled() ? '/' : 'https://zrg.zrbyhelp.com/')
})
