import { prisma } from '../../../utils/prisma'

export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ name?: string; enabled?: boolean }>(event)

  const data: { name?: string; enabled?: boolean; revokedAt?: Date | null } = {}
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim()
  if (typeof body.enabled === 'boolean') {
    data.enabled = body.enabled
    data.revokedAt = body.enabled ? null : new Date()
  }

  const token = await prisma.uploadToken.update({ where: { id }, data })
  await prisma.adminAuditLog.create({
    data: {
      adminName: admin.name,
      action: 'UPDATE_TOKEN',
      targetType: 'upload_token',
      targetId: token.id,
      detail: data
    }
  })

  return { ok: true }
})
