#!/usr/bin/env node
import { constants, readFileSync } from 'node:fs'
import { access, opendir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildR2Endpoint, headS3Object, putS3Object } from '../shared/s3-client.mjs'

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imageExtensions = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.avif',
  '.svg',
  '.bmp',
  '.tif',
  '.tiff'
])

async function main() {
  loadEnv(path.resolve(cwd, process.env.ENV_FILE || '.env'))

  const sourceDir = path.resolve(cwd, firstEnv('SRC_DIR', 'IMAGE_STORAGE_DIR') || 'storage/images')
  const config = getR2Config()
  const prefix = trim(process.env.R2_PREFIX).replace(/^\/+|\/+$/g, '')
  const overwrite = isEnabled(process.env.OVERWRITE)
  const dryRun = isEnabled(process.env.DRY_RUN)
  const cacheControl = trim(process.env.CACHE_CONTROL) || 'private, max-age=31536000, immutable'

  await requireDirectory(sourceDir)

  console.log(`Source: ${sourceDir}`)
  console.log(`Bucket: ${config.bucket}`)
  console.log(`Endpoint: ${config.endpoint || buildR2Endpoint(config.accountId)}`)
  if (prefix) console.log(`Prefix: ${prefix}`)
  console.log(`Overwrite: ${overwrite ? '1' : '0'}`)
  console.log(`Dry run: ${dryRun ? '1' : '0'}`)

  let scanned = 0
  let uploaded = 0
  let skipped = 0
  let failed = 0

  for await (const filePath of walkFiles(sourceDir)) {
    if (!isImageFile(filePath)) continue

    scanned += 1
    const rel = toPosixPath(path.relative(sourceDir, filePath))
    const key = prefix ? `${prefix}/${rel}` : rel

    try {
      const contentType = mimeFromPath(filePath)

      if (dryRun) {
        console.log(`dry-run upload: ${filePath} -> ${key} (${contentType})`)
        continue
      }

      if (!overwrite && await existsInR2(config, key)) {
        skipped += 1
        console.log(`skip existing: ${key}`)
        continue
      }

      const body = await readFile(filePath)
      await putS3Object(config, key, body, {
        contentType,
        cacheControl
      })

      uploaded += 1
      console.log(`uploaded: ${key}`)
    } catch (error) {
      failed += 1
      console.error(`failed: ${filePath} -> ${key}: ${error.message || error}`)
    }
  }

  console.log(`Done. scanned=${scanned} uploaded=${uploaded} skipped=${skipped} failed=${failed}`)

  if (failed > 0) process.exitCode = 1
}

async function* walkFiles(dir) {
  const entries = await opendir(dir)

  for await (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath)
    } else if (entry.isFile()) {
      yield fullPath
    }
  }
}

async function existsInR2(config, key) {
  try {
    await headS3Object(config, key)
    return true
  } catch (error) {
    if (error?.statusCode === 404) return false
    throw error
  }
}

function getR2Config() {
  const config = {
    endpoint: firstEnv('R2_ENDPOINT', 'CLOUDFLARE_R2_ENDPOINT', 'S3_ENDPOINT'),
    accountId: firstEnv('R2_ACCOUNT_ID', 'CLOUDFLARE_R2_ACCOUNT_ID', 'S3_ACCOUNT_ID'),
    bucket: firstEnv('R2_BUCKET', 'CLOUDFLARE_R2_BUCKET', 'S3_BUCKET'),
    accessKeyId: firstEnv('R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID', 'S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID'),
    secretAccessKey: firstEnv('R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'S3_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY'),
    region: firstEnv('R2_REGION', 'CLOUDFLARE_R2_REGION', 'S3_REGION', 'AWS_REGION') || 'auto'
  }

  const missing = []
  if (!config.endpoint && !config.accountId) missing.push('R2_ENDPOINT or R2_ACCOUNT_ID')
  if (!config.bucket) missing.push('R2_BUCKET')
  if (!config.accessKeyId) missing.push('R2_ACCESS_KEY_ID')
  if (!config.secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY')

  if (missing.length > 0) {
    throw new Error(`Missing env: ${missing.join(', ')}`)
  }

  return config
}

async function requireDirectory(dir) {
  await access(dir, constants.R_OK).catch(() => {
    throw new Error(`Source directory does not exist or is not readable: ${dir}`)
  })

  const info = await stat(dir)
  if (!info.isDirectory()) {
    throw new Error(`Source path is not a directory: ${dir}`)
  }
}

function loadEnv(filePath) {
  let content = ''
  try {
    content = readFileSync(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue

    const [, name, rawValue] = match
    if (process.env[name] !== undefined) continue
    process.env[name] = parseEnvValue(rawValue)
  }
}

function parseEnvValue(rawValue) {
  let value = rawValue.trim()

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  } else {
    value = value.replace(/\s+#.*$/, '')
  }

  return value
}

function firstEnv(...names) {
  for (const name of names) {
    const value = trim(process.env[name])
    if (value) return value
  }
  return ''
}

function isEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(trim(value).toLowerCase())
}

function isImageFile(filePath) {
  return imageExtensions.has(path.extname(filePath).toLowerCase())
}

function mimeFromPath(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.avif':
      return 'image/avif'
    case '.svg':
      return 'image/svg+xml'
    case '.bmp':
      return 'image/bmp'
    case '.tif':
    case '.tiff':
      return 'image/tiff'
    default:
      return 'application/octet-stream'
  }
}

function toPosixPath(value) {
  return value.split(path.sep).join('/')
}

function trim(value) {
  return String(value || '').trim()
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
