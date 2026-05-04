import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { resolveStoragePath } from '../../utils/storage'

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

export default defineEventHandler(async (event) => {
  requireUser(event)

  const raw = getRouterParam(event, 'path') || ''
  const storagePath = decodeURIComponent(raw)
  const file = resolveStoragePath(storagePath)
  const fileStat = await stat(file).catch(() => null)

  if (!fileStat?.isFile()) {
    throw createError({ statusCode: 404, statusMessage: 'Media not found' })
  }

  setHeader(event, 'content-type', MIME_BY_EXT[extname(file).toLowerCase()] || 'application/octet-stream')
  setHeader(event, 'content-length', fileStat.size)
  return sendStream(event, createReadStream(file))
})
