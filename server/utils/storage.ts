import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createError } from 'h3'
import { inferImageMetadata } from '~~/shared/image-metadata.mjs'
import { createPresignedS3GetUrl, deleteS3Object, getS3Object, putS3Object } from '~~/shared/s3-client.mjs'

export interface StoredImage {
  fileName: string
  storagePath: string
  mime: string
  size: number
  hash: string
  width: number | null
  height: number | null
}

export interface StoredImageStream {
  stream: Readable
  mime: string
  size: number | null
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

export function getStorageRoot() {
  return path.resolve(process.cwd(), useRuntimeConfig().imageStorageDir)
}

export function mediaUrl(storagePath: string) {
  const key = normalizeStoragePath(storagePath)
  if (getStorageDriver() === 'r2') {
    return createPresignedS3GetUrl(getR2StorageConfig(), key, {
      expiresIn: Number(useRuntimeConfig().r2SignedUrlTtlSeconds || 900)
    })
  }

  return localMediaUrl(key)
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

  if (getStorageDriver() === 'local') {
    const destination = path.join(getStorageRoot(), storagePath)
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, buffer)
  } else {
    await putS3Image(storagePath, buffer, metadata.mime)
  }

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

export async function readStoredImageStream(storagePath: string): Promise<StoredImageStream> {
  const key = normalizeStoragePath(storagePath)

  if (getStorageDriver() === 'local') {
    const file = resolveStoragePath(key)
    const fileStat = await stat(file).catch(() => null)
    if (!fileStat?.isFile()) {
      throw createError({ statusCode: 404, statusMessage: 'Media not found' })
    }

    return {
      stream: createReadStream(file),
      mime: MIME_BY_EXT[path.extname(file).toLowerCase()] || 'application/octet-stream',
      size: fileStat.size
    }
  }

  const response = await getS3Object(getR2StorageConfig(), key).catch((error) => {
    if (error?.statusCode === 404) {
      throw createError({ statusCode: 404, statusMessage: 'Media not found' })
    }

    throw createError({
      statusCode: error?.statusCode === 400 ? 400 : 502,
      statusMessage: error?.message || 'Cloudflare R2 media read failed'
    })
  })

  if (!response.body) {
    throw createError({ statusCode: 404, statusMessage: 'Media not found' })
  }

  const contentLength = Number(response.headers.get('content-length') || 0)
  return {
    stream: Readable.fromWeb(response.body as any),
    mime: response.headers.get('content-type') || mimeFromStoragePath(key),
    size: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null
  }
}

export async function deleteStoredImage(storagePath: string) {
  const key = normalizeStoragePath(storagePath)

  if (getStorageDriver() === 'local') {
    const file = resolveStoragePath(key)
    await unlink(file).catch((error: any) => {
      if (error?.code === 'ENOENT') return
      throw error
    })
    return
  }

  await deleteS3Object(getR2StorageConfig(), key).catch((error) => {
    throw createError({
      statusCode: error?.statusCode === 400 ? 400 : 502,
      statusMessage: error?.message || 'Cloudflare R2 delete failed'
    })
  })
}

export function getStorageDriver() {
  const driver = String(useRuntimeConfig().imageStorageDriver || 'r2').trim().toLowerCase()
  return driver === 'local' ? 'local' : 'r2'
}

export function isR2StorageEnabled() {
  return getStorageDriver() === 'r2'
}

export function signedStorageUrl(storagePath: string) {
  return mediaUrl(storagePath)
}

async function putS3Image(storagePath: string, buffer: Buffer, mime: string) {
  await putS3Object(getR2StorageConfig(), storagePath, buffer, {
    contentType: mime,
    cacheControl: 'private, max-age=31536000, immutable'
  }).catch((error) => {
    throw createError({
      statusCode: error?.statusCode === 400 ? 400 : 502,
      statusMessage: error?.message || 'Cloudflare R2 upload failed'
    })
  })
}

function getR2StorageConfig() {
  const config = useRuntimeConfig()
  return {
    endpoint: config.r2Endpoint,
    accountId: config.r2AccountId,
    bucket: config.r2Bucket,
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
    region: config.r2Region
  }
}

function normalizeStoragePath(storagePath: string) {
  const normalized = String(storagePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const segments = normalized.split('/')
  if (!normalized || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid media path' })
  }
  return normalized
}

function mimeFromStoragePath(storagePath: string) {
  return MIME_BY_EXT[path.extname(storagePath).toLowerCase()] || 'application/octet-stream'
}

function localMediaUrl(storagePath: string) {
  return `/media/${storagePath.split('/').map(encodeURIComponent).join('/')}`
}
