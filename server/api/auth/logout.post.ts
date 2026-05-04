export default defineEventHandler((event) => {
  clearUserSession(event)
  clearAdminSession(event)
  return { ok: true, logoutUrl: 'https://zrg.zrbyhelp.com/' }
})
