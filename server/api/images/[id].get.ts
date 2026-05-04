import { prisma } from '../../utils/prisma'
import { serializeImageSet } from '../../utils/serializers'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const user = requireUser(event)
  const userId = user.id
  const item = await prisma.imageSet.findFirst({
    where: { id, reviewStatus: 'PUBLISHED' },
    include: {
      images: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { favorites: true } },
      ...(userId
        ? {
            favorites: {
              where: { userId },
              select: { id: true, createdAt: true }
            }
          }
        : {})
    }
  })

  if (!item) {
    throw createError({ statusCode: 404, statusMessage: 'Image set not found' })
  }

  return serializeImageSet(item)
})
