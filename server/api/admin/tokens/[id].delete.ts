import { prisma } from '../../../utils/prisma'

export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)
  const id = getRouterParam(event, 'id')

  await prisma.uploadToken.update({
    where: { id },
    data: { enabled: false, revokedAt: new Date() }
  })
  await prisma.adminAuditLog.create({
    data: {
      adminName: admin.name,
      action: 'REVOKE_TOKEN',
      targetType: 'upload_token',
      targetId: id || '',
      detail: {}
    }
  })

  return { ok: true }
})
