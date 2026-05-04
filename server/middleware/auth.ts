export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  if (url.pathname !== '/') return
  if (getUserSession(event)) return

  const next = `${url.pathname}${url.search}`
  return sendRedirect(event, `/api/auth/login?next=${encodeURIComponent(next)}`)
})
