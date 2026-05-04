import { prisma } from '../../utils/prisma'

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const imageSetId = getRouterParam(event, 'id')
  if (!imageSetId) {
    throw createError({ statusCode: 400, statusMessage: 'Image set id is required' })
  }

  const imageSet = await prisma.imageSet.findFirst({
    where: { id: imageSetId, reviewStatus: 'PUBLISHED' },
    select: { id: true }
  })
  if (!imageSet) {
    throw createError({ statusCode: 404, statusMessage: 'Image set not found' })
  }

  await prisma.imageFavorite.upsert({
    where: { userId_imageSetId: { userId: user.id, imageSetId } },
    update: {},
    create: { userId: user.id, imageSetId }
  })

  const [favoriteCount, itemFavoriteCount] = await Promise.all([
    prisma.imageFavorite.count({ where: { userId: user.id } }),
    prisma.imageFavorite.count({ where: { imageSetId } })
  ])

  return {
    ok: true,
    isFavorited: true,
    favoriteCount: itemFavoriteCount,
    userFavoriteCount: favoriteCount
  }
})
