import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inferImageMetadata } from '../shared/image-metadata.mjs'
import { putS3Object } from '../shared/s3-client.mjs'

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadDotEnv(path.join(cwd, '.env'))
const prisma = new PrismaClient()
const manifestPath = path.resolve(cwd, process.argv[2] || '参考/test/manifest.json')
const manifestDir = path.dirname(manifestPath)
const storageDriver = String(process.env.IMAGE_STORAGE_DRIVER || 'r2').trim().toLowerCase()
const storageRoot = path.resolve(cwd, process.env.IMAGE_STORAGE_DIR || 'storage/images')

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const items = Array.isArray(manifest.items) ? manifest.items : []
  let importedSets = 0
  let importedFiles = 0

  await ensureLocalDirectory(path.join(storageRoot, 'fixture'))

  for (const item of items) {
    const outputImages = Array.isArray(item.outputImages) ? item.outputImages : []
    if (!item.id || !item.prompt || outputImages.length === 0) {
      continue
    }
    const referenceImages = await importReferenceImages(item)

    const imageSet = await prisma.imageSet.upsert({
      where: { externalId: item.id },
      create: {
        externalId: item.id,
        userId: item.userId || null,
        userAccount: item.userAccount || null,
        userEmail: item.userEmail || null,
        userUsername: item.userUsername || null,
        userName: item.userName || null,
        prompt: item.prompt,
        revisedPrompts: item.revisedPrompts || [],
        params: item.params || {},
        requestedImageCount: Number(item.requestedImageCount || outputImages.length),
        inputImageCount: Number(item.inputImageCount || 0),
        referenceImages,
        maskUsed: Boolean(item.maskUsed),
        apiProvider: item.apiProvider || null,
        apiModel: item.apiModel || null,
        generationStatus: item.status || null,
        error: item.error || null,
        source: 'FIXTURE',
        reviewStatus: 'PUBLISHED',
        generatedAt: item.createdAt ? new Date(item.createdAt) : null,
        finishedAt: item.finishedAt ? new Date(item.finishedAt) : null,
        elapsed: Number.isFinite(Number(item.elapsed)) ? Number(item.elapsed) : null,
        actualParams: item.actualParams || {},
        createdAt: item.createdAt ? new Date(item.createdAt) : new Date()
      },
      update: {
        userId: item.userId || null,
        userAccount: item.userAccount || null,
        userEmail: item.userEmail || null,
        userUsername: item.userUsername || null,
        userName: item.userName || null,
        prompt: item.prompt,
        revisedPrompts: item.revisedPrompts || [],
        params: item.params || {},
        requestedImageCount: Number(item.requestedImageCount || outputImages.length),
        inputImageCount: Number(item.inputImageCount || 0),
        referenceImages,
        maskUsed: Boolean(item.maskUsed),
        apiProvider: item.apiProvider || null,
        apiModel: item.apiModel || null,
        generationStatus: item.status || null,
        error: item.error || null,
        source: 'FIXTURE',
        reviewStatus: 'PUBLISHED',
        generatedAt: item.createdAt ? new Date(item.createdAt) : null,
        finishedAt: item.finishedAt ? new Date(item.finishedAt) : null,
        elapsed: Number.isFinite(Number(item.elapsed)) ? Number(item.elapsed) : null,
        actualParams: item.actualParams || {}
      }
    })

    await prisma.imageFile.deleteMany({ where: { imageSetId: imageSet.id } })

    for (const [index, image] of outputImages.entries()) {
      const source = path.resolve(manifestDir, image.exportPath || path.join('images', image.fileName))
      const fileName = image.fileName || path.basename(source)
      const relativeStoragePath = path.posix.join('fixture', fileName)
      const destination = path.join(storageRoot, relativeStoragePath)
      const fileStat = await stat(source)
      const buffer = await readFile(source)
      const metadata = inferImageMetadata(buffer, image.mime)
      const hash = image.hash || sha256Buffer(buffer)

      await persistImageBuffer(relativeStoragePath, buffer, metadata.mime, destination)
      await prisma.imageFile.create({
        data: {
          externalId: image.id || null,
          imageSetId: imageSet.id,
          fileName,
          storagePath: relativeStoragePath,
          mime: metadata.mime,
          size: Number(image.size || fileStat.size),
          hash,
          width: metadata.width,
          height: metadata.height,
          sortOrder: index
        }
      })
      importedFiles += 1
    }

    importedSets += 1
  }

  console.log(`Imported ${importedSets} image sets and ${importedFiles} image files from ${manifestPath}`)
}

async function importReferenceImages(item) {
  const references = Array.isArray(item.referenceImages) ? item.referenceImages : []
  if (references.length === 0) return []

  const saved = []
  await ensureLocalDirectory(path.join(storageRoot, 'fixture', 'references'))

  for (const [index, image] of references.entries()) {
    if (image.url && !image.exportPath && !image.relativePath && !image.fileName) {
      saved.push({
        id: image.id || `${item.id}-reference-${index + 1}`,
        fileName: image.name || `reference-${index + 1}`,
        url: image.url,
        mime: image.mime || '',
        size: Number(image.size || 0),
        hash: image.hash || '',
        width: image.width || null,
        height: image.height || null,
        sortOrder: index
      })
      continue
    }

    const source = path.resolve(manifestDir, image.exportPath || image.relativePath || path.join('images', image.fileName || ''))
    const fileName = image.fileName || path.basename(source)
    const relativeStoragePath = path.posix.join('fixture', 'references', `${item.id}-${index + 1}-${fileName}`)
    const destination = path.join(storageRoot, relativeStoragePath)
    const fileStat = await stat(source)
    const buffer = await readFile(source)
    const metadata = inferImageMetadata(buffer, image.mime)
    const hash = image.hash || sha256Buffer(buffer)

    await persistImageBuffer(relativeStoragePath, buffer, metadata.mime, destination)
    saved.push({
      id: image.id || `${item.id}-reference-${index + 1}`,
      fileName,
      storagePath: relativeStoragePath,
      mime: metadata.mime,
      size: Number(image.size || fileStat.size),
      hash,
      width: metadata.width,
      height: metadata.height,
      sortOrder: index
    })
  }

  return saved
}

async function persistImageBuffer(storagePath, buffer, mime, localDestination) {
  if (storageDriver === 'local') {
    await mkdir(path.dirname(localDestination), { recursive: true })
    await writeFile(localDestination, buffer)
    return
  }

  await putS3Object(getR2StorageConfig(), storagePath, buffer, {
    contentType: mime,
    cacheControl: 'private, max-age=31536000, immutable'
  })
}

async function ensureLocalDirectory(directory) {
  if (storageDriver === 'local') {
    await mkdir(directory, { recursive: true })
  }
}

function getR2StorageConfig() {
  return {
    endpoint: firstEnv('R2_ENDPOINT', 'CLOUDFLARE_R2_ENDPOINT', 'S3_ENDPOINT'),
    accountId: firstEnv('R2_ACCOUNT_ID', 'CLOUDFLARE_R2_ACCOUNT_ID', 'S3_ACCOUNT_ID'),
    bucket: firstEnv('R2_BUCKET', 'CLOUDFLARE_R2_BUCKET', 'S3_BUCKET'),
    accessKeyId: firstEnv('R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID', 'S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID'),
    secretAccessKey: firstEnv('R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'S3_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY'),
    region: firstEnv('R2_REGION', 'CLOUDFLARE_R2_REGION', 'S3_REGION', 'AWS_REGION') || 'auto'
  }
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return ''
}

function loadDotEnv(file) {
  if (!existsSync(file)) return

  const content = readFileSync(file, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
    if (!match || match[1].startsWith('#')) continue
    if (process.env[match[1]] !== undefined) continue

    const raw = String(match[2] || '').trim()
    process.env[match[1]] = raw.replace(/^['"]|['"]$/g, '')
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
