import { randomToken, sha256 } from '../../../utils/crypto'
import { prisma } from '../../../utils/prisma'

export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)
  const body = await readBody<{ name?: string; reviewRequired?: boolean }>(event)
  const name = String(body.name || '').trim()
  const reviewRequired = typeof body.reviewRequired === 'boolean' ? body.reviewRequired : true

  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Token name is required' })
  }

  const plaintext = randomToken('zr_upload')
  const token = await prisma.uploadToken.create({
    data: {
      name,
      tokenHash: sha256(plaintext),
      tokenPrefix: plaintext.slice(0, 18),
      reviewRequired
    }
  })

  await prisma.adminAuditLog.create({
    data: {
      adminName: admin.name,
      action: 'CREATE_TOKEN',
      targetType: 'upload_token',
      targetId: token.id,
      detail: { name, reviewRequired }
    }
  })

  return {
    token: plaintext,
    item: {
      id: token.id,
      name: token.name,
      tokenPrefix: token.tokenPrefix,
      enabled: token.enabled,
      reviewRequired: token.reviewRequired,
      createdAt: token.createdAt.toISOString(),
      lastUsedAt: null,
      revokedAt: null
    }
  }
})
