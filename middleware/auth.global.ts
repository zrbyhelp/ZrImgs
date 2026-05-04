export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path !== '/' || import.meta.server) return

  const session = useState<any>('session', () => ({ user: null, admin: null }))
  const data = await $fetch<any>('/api/session').catch(() => ({ user: null, admin: null }))
  session.value = data

  if (!data.user) {
    window.location.href = `/api/auth/login?next=${encodeURIComponent(to.fullPath || '/')}`
    return abortNavigation()
  }
})
