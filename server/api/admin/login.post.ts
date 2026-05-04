export default defineEventHandler(() => {
  throw createError({ statusCode: 410, statusMessage: 'Admin password login has been removed' })
})
