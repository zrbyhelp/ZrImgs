import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluatePromptQuality } from '../shared/prompt-quality.mjs'
import { inferImageMetadata } from '../shared/image-metadata.mjs'

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.resolve(cwd, process.argv[2] || '参考/test/manifest.json')
const manifestDir = path.dirname(manifestPath)
const endpoint = new URL('/api/uploads/third-party', requireEnv('UPLOAD_BASE_URL')).toString()
const token = requireEnv('UPLOAD_TOKEN')
const limit = Number(process.env.UPLOAD_LIMIT || 0)

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const items = Array.isArray(manifest.items) ? manifest.items : []

  let uploaded = 0
  let skippedInvalidPrompt = 0
  let skippedNoImages = 0
  let failed = 0

  for (const item of items) {
    if (limit && uploaded >= limit) break

    const quality = evaluatePromptQuality(item.prompt)
    if (!quality.ok) {
      skippedInvalidPrompt += 1
      continue
    }

    const outputImages = Array.isArray(item.outputImages) ? item.outputImages : []
    if (outputImages.length === 0) {
      skippedNoImages += 1
      continue
    }

    try {
      const response = await uploadItem(item, outputImages)
      uploaded += 1
      console.log(`[${uploaded}] uploaded ${item.id} -> ${response.id} (${response.reviewStatus})`)
    } catch (error) {
      failed += 1
      console.error(`failed ${item.id}: ${error.message}`)
      if ([401, 403, 404].includes(error.statusCode)) break
    }
  }

  console.log(JSON.stringify({
    uploaded,
    failed,
    skippedInvalidPrompt,
    skippedNoImages,
    total: items.length
  }, null, 2))

  if (failed > 0) process.exitCode = 1
}

async function uploadItem(item, outputImages) {
  const form = new FormData()
  form.append('prompt', item.prompt)

  if (item.apiProvider) form.append('provider', item.apiProvider)
  if (item.apiModel) form.append('model', item.apiModel)
  appendOptionalText(form, 'userId', item.userId)
  appendOptionalText(form, 'userAccount', item.userAccount)
  appendOptionalText(form, 'userEmail', item.userEmail)
  appendOptionalText(form, 'userUsername', item.userUsername)
  appendOptionalText(form, 'userName', item.userName)
  form.append('params', JSON.stringify({
    ...(item.params || {}),
    fixtureId: item.id,
    generatedAt: item.createdAt || null
  }))

  for (const image of outputImages) {
    await appendImage(form, 'images[]', resolveImagePath(image), image.fileName)
  }

  for (const image of Array.isArray(item.referenceImages) ? item.referenceImages : []) {
    if (image.url && !image.exportPath && !image.relativePath && !image.fileName) continue
    await appendImage(
      form,
      'referenceImages[]',
      resolveImagePath(image),
      image.fileName || image.name
    )
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: form
  })

  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = { message: text }
  }

  if (!response.ok) {
    const error = new Error(payload.statusMessage || payload.message || `${response.status} ${response.statusText}`)
    error.statusCode = response.status
    throw error
  }

  return payload
}

function appendOptionalText(form, name, value) {
  const text = String(value || '').trim()
  if (text) form.append(name, text)
}

async function appendImage(form, fieldName, filePath, fallbackName) {
  const buffer = await readFile(filePath)
  const metadata = inferImageMetadata(buffer, mimeFromPath(filePath))
  form.append(
    fieldName,
    new Blob([buffer], { type: metadata.mime }),
    fallbackName || path.basename(filePath)
  )
}

function resolveImagePath(image) {
  return path.resolve(
    manifestDir,
    image.exportPath || image.relativePath || path.join('images', image.fileName || '')
  )
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.png') return 'image/png'
  return ''
}

function requireEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
