import { Prisma } from '@prisma/client'
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
  const baseWhere = imageWhere(search, favoritesOnly ? userId : '')
  const [groups, totalRows, favoriteCount] = await Promise.all([
    findPromptGroups({ search, favoritesOnly, userId, skip, limit }),
    countPromptGroups({ search, favoritesOnly, userId }),
    prisma.imageFavorite.count({ where: { userId } })
  ])
  const representativeIds = groups.map((group) => group.id)

  if (representativeIds.length === 0) {
    const total = Number(totalRows[0]?.total || 0)
    return {
      page,
      limit,
      total,
      favoriteCount,
      hasMore: false,
      items: []
    }
  }

  const prompts = groups.map((group) => group.prompt)
  const [representatives, groupedItems] = await Promise.all([
    prisma.imageSet.findMany({
      where: { id: { in: representativeIds } },
      orderBy: feedOrderBy,
      include
    }),
    prisma.imageSet.findMany({
      where: { ...baseWhere, prompt: { in: prompts } },
      orderBy: feedOrderBy,
      include
    })
  ])

  const representativesById = new Map(representatives.map((item) => [item.id, item]))
  const groupedByPrompt = new Map<string, any[]>()
  for (const item of groupedItems) {
    const prompt = String(item.prompt || '')
    const existing = groupedByPrompt.get(prompt) || []
    existing.push(item)
    groupedByPrompt.set(prompt, existing)
  }

  const total = Number(totalRows[0]?.total || 0)

  return {
    page,
    limit,
    total,
    favoriteCount,
    hasMore: skip + groups.length < total,
    items: groups
      .map((group) => {
        const representative = representativesById.get(group.id)
        if (!representative) return null

        const promptGroupItems = (groupedByPrompt.get(group.prompt) || []).map(serializeImageSet)
        return {
          ...serializeImageSet(representative),
          promptGroupCount: Number(group.promptGroupCount || promptGroupItems.length),
          promptGroupItems
        }
      })
      .filter(Boolean)
  }
})

type PromptGroupRow = {
  id: string
  prompt: string
  promptGroupCount: number | bigint
}

type CountRow = {
  total: number | bigint
}

function findPromptGroups(options: {
  search: string
  favoritesOnly: boolean
  userId: string
  skip: number
  limit: number
}) {
  const whereSql = imageWhereSql(options.search, options.favoritesOnly ? options.userId : '')
  return prisma.$queryRaw<PromptGroupRow[]>`
    WITH favorite_counts AS (
      SELECT imageSetId, COUNT(*) AS favoriteCount
      FROM ImageFavorite
      GROUP BY imageSetId
    ),
    ranked AS (
      SELECT
        image_set.id,
        image_set.prompt,
        COALESCE(favorite_counts.favoriteCount, 0) AS favoriteCount,
        image_set.createdAt,
        ROW_NUMBER() OVER (
          PARTITION BY SHA2(image_set.prompt, 256)
          ORDER BY COALESCE(favorite_counts.favoriteCount, 0) DESC, image_set.createdAt DESC, image_set.id DESC
        ) AS rowNumber,
        COUNT(*) OVER (PARTITION BY SHA2(image_set.prompt, 256)) AS promptGroupCount
      FROM ImageSet image_set
      LEFT JOIN favorite_counts ON favorite_counts.imageSetId = image_set.id
      WHERE ${whereSql}
    )
    SELECT id, prompt, promptGroupCount
    FROM ranked
    WHERE rowNumber = 1
    ORDER BY favoriteCount DESC, createdAt DESC, id DESC
    LIMIT ${options.limit}
    OFFSET ${options.skip}
  `
}

function countPromptGroups(options: {
  search: string
  favoritesOnly: boolean
  userId: string
}) {
  const whereSql = imageWhereSql(options.search, options.favoritesOnly ? options.userId : '')
  return prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*) AS total
    FROM (
      SELECT SHA2(image_set.prompt, 256) AS promptKey
      FROM ImageSet image_set
      WHERE ${whereSql}
      GROUP BY SHA2(image_set.prompt, 256)
    ) prompt_groups
  `
}

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

function imageWhere(search: string, favoriteUserId: string): Prisma.ImageSetWhereInput {
  return {
    reviewStatus: 'PUBLISHED',
    ...(favoriteUserId
      ? {
          favorites: { some: { userId: favoriteUserId } }
        }
      : {}),
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
}

function imageWhereSql(search: string, favoriteUserId: string) {
  const clauses: Prisma.Sql[] = [Prisma.sql`image_set.reviewStatus = 'PUBLISHED'`]

  if (favoriteUserId) {
    clauses.push(Prisma.sql`
      EXISTS (
        SELECT 1
        FROM ImageFavorite favorite_filter
        WHERE favorite_filter.imageSetId = image_set.id
          AND favorite_filter.userId = ${favoriteUserId}
      )
    `)
  }

  if (search) {
    const like = `%${search}%`
    clauses.push(Prisma.sql`
      (
        image_set.prompt LIKE ${like}
        OR image_set.id LIKE ${like}
        OR image_set.externalId LIKE ${like}
      )
    `)
  }

  return Prisma.join(clauses, ' AND ')
}
