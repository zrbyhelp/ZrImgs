import { prisma } from '../../../../utils/prisma'

export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ privacyBlurred?: boolean }>(event)

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Image set id is required' })
  }

  const privacyBlurred = body.privacyBlurred === true
  const item = await prisma.imageSet.update({
    where: { id },
    data: { privacyBlurred },
    select: { id: true, privacyBlurred: true }
  })

  await prisma.adminAuditLog.create({
    data: {
      imageSetId: item.id,
      adminName: admin.name,
      action: 'UPDATE_IMAGE_PRIVACY',
      targetType: 'image_set',
      targetId: item.id,
      detail: { privacyBlurred: item.privacyBlurred }
    }
  })

  return {
    ok: true,
    id: item.id,
    privacyBlurred: item.privacyBlurred
  }
})
