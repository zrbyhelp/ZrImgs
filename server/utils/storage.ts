import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createError } from 'h3'
import { inferImageMetadata } from '~~/shared/image-metadata.mjs'

export interface StoredImage {
  fileName: string
  storagePath: string
  mime: string
  size: number
  hash: string
  width: number | null
  height: number | null
}

export function getStorageRoot() {
  return path.resolve(process.cwd(), useRuntimeConfig().imageStorageDir)
}

export function mediaUrl(storagePath: string) {
  return `/media/${storagePath.split(/[\\/]/).map(encodeURIComponent).join('/')}`
}

export function resolveStoragePath(storagePath: string) {
  const root = getStorageRoot()
  const file = path.resolve(root, storagePath)
  if (!file.startsWith(root + path.sep) && file !== root) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid media path' })
  }
  return file
}

export async function saveImageBuffer(buffer: Buffer, originalName: string, mime = '', bucket = 'uploads'): Promise<StoredImage> {
  const metadata = inferImageMetadata(buffer, mime)
  if (!metadata.mime.startsWith('image/') || metadata.ext === 'bin') {
    throw createError({ statusCode: 400, statusMessage: 'Only png, jpeg and webp images are supported' })
  }

  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const safeOriginal = path.basename(originalName || `image.${metadata.ext}`).replace(/[^\w.-]+/g, '_')
  const fileName = `${randomUUID()}-${safeOriginal.replace(/\.[^.]+$/, '')}.${metadata.ext}`
  const storagePath = path.posix.join(bucket, today, fileName)
  const destination = path.join(getStorageRoot(), storagePath)

  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, buffer)

  return {
    fileName,
    storagePath,
    mime: metadata.mime,
    size: buffer.length,
    hash: createHash('sha256').update(buffer).digest('hex'),
    width: metadata.width,
    height: metadata.height
  }
}
