import { prisma } from '../../../utils/prisma'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const tokens = await prisma.uploadToken.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      enabled: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true
    }
  })

  return {
    items: tokens.map((token) => ({
      ...token,
      createdAt: token.createdAt.toISOString(),
      lastUsedAt: token.lastUsedAt?.toISOString() || null,
      revokedAt: token.revokedAt?.toISOString() || null
    }))
  }
})
