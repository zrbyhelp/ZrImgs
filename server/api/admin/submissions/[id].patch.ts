import { prisma } from '../../../utils/prisma'

export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ reviewStatus?: string }>(event)
  const reviewStatus = String(body.reviewStatus || '').toUpperCase()

  if (!['PUBLISHED', 'REJECTED', 'PENDING'].includes(reviewStatus)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid review status' })
  }

  const item = await prisma.imageSet.update({
    where: { id },
    data: { reviewStatus: reviewStatus as any }
  })

  await prisma.adminAuditLog.create({
    data: {
      imageSetId: item.id,
      adminName: admin.name,
      action: 'REVIEW_SUBMISSION',
      targetType: 'image_set',
      targetId: item.id,
      detail: { reviewStatus }
    }
  })

  return { ok: true }
})
