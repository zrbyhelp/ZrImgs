import { prisma } from '../../utils/prisma'

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const imageSetId = getRouterParam(event, 'id')
  if (!imageSetId) {
    throw createError({ statusCode: 400, statusMessage: 'Image set id is required' })
  }

  await prisma.imageFavorite.deleteMany({
    where: { userId: user.id, imageSetId }
  })

  const [favoriteCount, itemFavoriteCount] = await Promise.all([
    prisma.imageFavorite.count({ where: { userId: user.id } }),
    prisma.imageFavorite.count({ where: { imageSetId } })
  ])

  return {
    ok: true,
    isFavorited: false,
    favoriteCount: itemFavoriteCount,
    userFavoriteCount: favoriteCount
  }
})
