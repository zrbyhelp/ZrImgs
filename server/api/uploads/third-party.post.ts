import { evaluatePromptQuality } from '~~/shared/prompt-quality.mjs'
import { sha256 } from '../../utils/crypto'
import { prisma } from '../../utils/prisma'
import { saveImageBuffer } from '../../utils/storage'

export default defineEventHandler(async (event) => {
  const tokenValue = getBearerToken(getHeader(event, 'authorization'))
  if (!tokenValue) {
    throw createError({ statusCode: 401, statusMessage: 'Upload token is required' })
  }

  const token = await prisma.uploadToken.findUnique({ where: { tokenHash: sha256(tokenValue) } })
  if (!token?.enabled) {
    throw createError({ statusCode: 401, statusMessage: 'Upload token is invalid or disabled' })
  }

  const form = await readMultipartFormData(event)
  if (!form?.length) {
    throw createError({ statusCode: 400, statusMessage: 'Multipart form data is required' })
  }

  const prompt = readTextField(form, 'prompt')
  const quality = evaluatePromptQuality(prompt)
  if (!quality.ok) {
    throw createError({ statusCode: 400, statusMessage: quality.reason })
  }

  const imageParts = form.filter((part) => ['images', 'images[]'].includes(part.name || '') && part.filename && part.data)
  if (imageParts.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'At least one image file is required' })
  }

  const maxBytes = Number(useRuntimeConfig().uploadMaxBytes)
  const imageTotalBytes = imageParts.reduce((sum, part) => sum + part.data.length, 0)
  if (imageTotalBytes > maxBytes) {
    throw createError({ statusCode: 413, statusMessage: 'Uploaded images are too large' })
  }

  const referenceParts = form.filter((part) => ['referenceImages', 'referenceImages[]'].includes(part.name || '') && part.filename && part.data)
  const savedImages = []
  const savedReferences = []

  for (const part of imageParts) {
    savedImages.push(await saveImageBuffer(Buffer.from(part.data), part.filename || 'image', part.type || '', 'third-party'))
  }

  for (const part of referenceParts) {
    savedReferences.push(await saveImageBuffer(Buffer.from(part.data), part.filename || 'reference', part.type || '', 'references'))
  }

  const params = parseJsonField(readTextField(form, 'params'), {})
  const model = readTextField(form, 'model') || null
  const provider = readTextField(form, 'provider') || null
  const reviewStatus = token.reviewRequired ? 'PENDING' : 'PUBLISHED'

  const imageSet = await prisma.imageSet.create({
    data: {
      prompt,
      revisedPrompts: [],
      params,
      requestedImageCount: savedImages.length,
      inputImageCount: savedReferences.length,
      referenceImages: savedReferences.map((image) => ({
        fileName: image.fileName,
        storagePath: image.storagePath,
        mime: image.mime,
        size: image.size,
        hash: image.hash,
        width: image.width,
        height: image.height
      })),
      apiProvider: provider,
      apiModel: model,
      generationStatus: 'uploaded',
      source: 'THIRD_PARTY',
      reviewStatus,
      sourceTokenId: token.id,
      images: {
        create: savedImages.map((image, index) => ({
          fileName: image.fileName,
          storagePath: image.storagePath,
          mime: image.mime,
          size: image.size,
          hash: image.hash,
          width: image.width,
          height: image.height,
          sortOrder: index
        }))
      }
    }
  })

  await prisma.uploadToken.update({
    where: { id: token.id },
    data: { lastUsedAt: new Date() }
  })

  return { ok: true, id: imageSet.id, reviewStatus: imageSet.reviewStatus }
})

function getBearerToken(header?: string) {
  const match = String(header || '').match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

function readTextField(form: Awaited<ReturnType<typeof readMultipartFormData>>, name: string) {
  const part = form?.find((item) => item.name === name && !item.filename)
  if (!part?.data) return ''
  return Buffer.from(part.data).toString('utf8').trim()
}

function parseJsonField(value: string, fallback: unknown) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}
