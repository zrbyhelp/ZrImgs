export default defineEventHandler((event) => {
  clearAdminSession(event)
  return { ok: true, admin: getAdminSession(event) }
})
