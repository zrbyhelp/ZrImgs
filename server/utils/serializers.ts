import { mediaUrl } from './storage'

export function serializeImageSet(row: any) {
  const images = Array.isArray(row.images) ? row.images : []
  const favorites = Array.isArray(row.favorites) ? row.favorites : []

  return {
    id: row.id,
    externalId: row.externalId,
    user: {
      id: row.userId,
      account: row.userAccount,
      email: row.userEmail,
      username: row.userUsername,
      name: row.userName
    },
    prompt: row.prompt,
    revisedPrompts: row.revisedPrompts || [],
    params: row.params || {},
    requestedImageCount: row.requestedImageCount,
    inputImageCount: row.inputImageCount,
    referenceImages: normalizeReferenceImages(row.referenceImages),
    maskUsed: row.maskUsed,
    apiProvider: row.apiProvider,
    apiModel: row.apiModel,
    generationStatus: row.generationStatus,
    error: row.error,
    source: row.source,
    reviewStatus: row.reviewStatus,
    generatedAt: row.generatedAt?.toISOString?.() || null,
    finishedAt: row.finishedAt?.toISOString?.() || null,
    elapsed: row.elapsed,
    actualParams: row.actualParams || {},
    createdAt: row.createdAt?.toISOString?.() || null,
    isFavorited: favorites.length > 0,
    favoriteCount: row._count?.favorites || 0,
    favoriteCreatedAt: favorites[0]?.createdAt?.toISOString?.() || null,
    images: images.map((image: any) => ({
      id: image.id,
      externalId: image.externalId,
      fileName: image.fileName,
      url: mediaUrl(image.storagePath),
      mime: image.mime,
      size: image.size,
      hash: image.hash,
      width: image.width,
      height: image.height,
      sortOrder: image.sortOrder
    }))
  }
}

function normalizeReferenceImages(value: unknown) {
  if (!Array.isArray(value)) return []

  return value
    .map((image: any, index) => {
      if (!image || typeof image !== 'object') return null
      const url = typeof image.url === 'string'
        ? image.url
        : typeof image.storagePath === 'string'
          ? mediaUrl(image.storagePath)
          : ''

      return {
        id: image.id || `reference-${index + 1}`,
        fileName: image.fileName || image.name || `reference-${index + 1}`,
        url,
        mime: image.mime || image.type || '',
        size: image.size || 0,
        hash: image.hash || '',
        width: image.width || null,
        height: image.height || null,
        sortOrder: image.sortOrder ?? index
      }
    })
    .filter(Boolean)
}
