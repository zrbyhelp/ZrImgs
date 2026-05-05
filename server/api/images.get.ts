import type { Prisma } from '@prisma/client'
import { prisma } from '../utils/prisma'
import { serializeImageSet } from '../utils/serializers'

const feedOrderBy = [
  { favorites: { _count: 'desc' } },
  { createdAt: 'desc' },
  { id: 'desc' }
] satisfies Prisma.ImageSetOrderByWithRelationInput[]

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const query = getQuery(event)
  const page = Math.max(Number(query.page || 1), 1)
  const limit = Math.min(Math.max(Number(query.limit || 24), 1), 60)
  const skip = (page - 1) * limit
  const userId = user.id
  const favoritesOnly = query.favorites === '1' || query.favorites === 'true'
  const search = readSearchQuery(query.q)

  const include = imageInclude(userId)
  const baseWhere: Prisma.ImageSetWhereInput = {
    reviewStatus: 'PUBLISHED',
    ...(search
      ? {
          OR: [
            { prompt: { contains: search } },
            { id: { contains: search } },
            { externalId: { contains: search } }
          ]
        }
      : {})
  }

  if (favoritesOnly) {
    const where = { ...baseWhere, favorites: { some: { userId } } }
    const [items, total, favoriteCount] = await Promise.all([
      prisma.imageSet.findMany({
        where,
        orderBy: feedOrderBy,
        skip,
        take: limit,
        include
      }),
      prisma.imageSet.count({ where }),
      prisma.imageFavorite.count({ where: { userId } })
    ])

    return {
      page,
      limit,
      total,
      favoriteCount,
      hasMore: skip + items.length < total,
      items: items.map(serializeImageSet)
    }
  }

  const [items, total, favoriteCount] = await Promise.all([
    prisma.imageSet.findMany({
      where: baseWhere,
      orderBy: feedOrderBy,
      skip,
      take: limit,
      include
    }),
    prisma.imageSet.count({ where: baseWhere }),
    prisma.imageFavorite.count({ where: { userId } })
  ])

  return {
    page,
    limit,
    total,
    favoriteCount,
    hasMore: skip + items.length < total,
    items: items.map(serializeImageSet)
  }
})

function imageInclude(userId: string) {
  return {
    images: { orderBy: { sortOrder: 'asc' as const } },
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
}

function readSearchQuery(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' ? raw.trim() : ''
}
