import { prisma } from '../../../utils/prisma'
import { deleteStoredImage } from '../../../utils/storage'

export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Image set id is required' })
  }

  const item = await prisma.imageSet.findUnique({
    where: { id },
    include: {
      images: { select: { storagePath: true } }
    }
  })

  if (!item) {
    throw createError({ statusCode: 404, statusMessage: 'Image set not found' })
  }

  const imagePaths = item.images.map((image) => image.storagePath).filter(Boolean)
  const referencePaths = referenceStoragePaths(item.referenceImages)
  const storagePaths = [...new Set([...imagePaths, ...referencePaths])]

  await prisma.imageSet.delete({ where: { id } })

  const storageDeleteFailures: Array<{ storagePath: string; message: string }> = []
  for (const storagePath of storagePaths) {
    try {
      await deleteStoredImage(storagePath)
    } catch (error: any) {
      storageDeleteFailures.push({
        storagePath,
        message: error?.statusMessage || error?.message || 'Storage delete failed'
      })
    }
  }

  await prisma.adminAuditLog.create({
    data: {
      adminName: admin.name,
      action: 'DELETE_IMAGE_SET',
      targetType: 'image_set',
      targetId: id,
      detail: {
        imageCount: imagePaths.length,
        referenceImageCount: referencePaths.length,
        storageDeleteFailed: storageDeleteFailures.length,
        storageDeleteFailures: storageDeleteFailures.slice(0, 20)
      }
    }
  })

  return {
    ok: true,
    deletedId: id,
    storageDeleteFailed: storageDeleteFailures.length
  }
})

function referenceStoragePaths(value: unknown) {
  if (!Array.isArray(value)) return []

  return value
    .map((image: any) => typeof image?.storagePath === 'string' ? image.storagePath.trim() : '')
    .filter(Boolean)
}
