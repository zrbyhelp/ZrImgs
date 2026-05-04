export default defineEventHandler((event) => {
  clearUserSession(event)
  clearAdminSession(event)
  return sendRedirect(event, 'https://zrg.zrbyhelp.com/')
})
