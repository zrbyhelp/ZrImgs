import { prisma } from '../../../utils/prisma'
import { serializeImageSet } from '../../../utils/serializers'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const query = getQuery(event)
  const status = String(query.status || 'PENDING').toUpperCase()
  const page = Math.max(Number(query.page || 1), 1)
  const limit = Math.min(Math.max(Number(query.limit || 30), 1), 80)

  const where = ['PENDING', 'PUBLISHED', 'REJECTED'].includes(status)
    ? { reviewStatus: status as any }
    : {}

  const [items, total] = await Promise.all([
    prisma.imageSet.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { images: { orderBy: { sortOrder: 'asc' } } }
    }),
    prisma.imageSet.count({ where })
  ])

  return {
    page,
    limit,
    total,
    items: items.map(serializeImageSet)
  }
})
