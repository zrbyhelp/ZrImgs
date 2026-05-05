import { isR2StorageEnabled, readStoredImageStream, signedStorageUrl } from '../../utils/storage'

export default defineEventHandler(async (event) => {
  requireUser(event)

  const raw = getRouterParam(event, 'path') || ''
  const storagePath = decodeMediaPath(raw)

  if (isR2StorageEnabled()) {
    return sendRedirect(event, signedStorageUrl(storagePath), 302)
  }

  const image = await readStoredImageStream(storagePath)

  setHeader(event, 'content-type', image.mime)
  if (image.size) setHeader(event, 'content-length', image.size)
  return sendStream(event, image.stream)
})

function decodeMediaPath(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid media path' })
  }
}
