export default defineEventHandler((event) => {
  return {
    user: getUserSession(event),
    admin: getAdminSession(event)
  }
})
