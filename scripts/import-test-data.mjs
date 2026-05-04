import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inferImageMetadata } from '../shared/image-metadata.mjs'

const prisma = new PrismaClient()
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.resolve(cwd, process.argv[2] || '参考/test/manifest.json')
const manifestDir = path.dirname(manifestPath)
const storageRoot = path.resolve(cwd, process.env.IMAGE_STORAGE_DIR || 'storage/images')

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const items = Array.isArray(manifest.items) ? manifest.items : []
  let importedSets = 0
  let importedFiles = 0

  await mkdir(path.join(storageRoot, 'fixture'), { recursive: true })

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
      const sample = await readFile(source)
      const metadata = inferImageMetadata(sample, image.mime)
      const hash = image.hash || await sha256File(source)

      await copyFile(source, destination)
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
  await mkdir(path.join(storageRoot, 'fixture', 'references'), { recursive: true })

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
    const sample = await readFile(source)
    const metadata = inferImageMetadata(sample, image.mime)
    const hash = image.hash || await sha256File(source)

    await copyFile(source, destination)
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

async function sha256File(file) {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
