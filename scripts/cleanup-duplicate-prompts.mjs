#!/usr/bin/env node
import { createWriteStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { deleteS3Object } from '../shared/s3-client.mjs'

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_GROUP_BATCH_SIZE = 20
const DEFAULT_DELETE_CONCURRENCY = 1
const DEFAULT_SIMILARITY_THRESHOLD = 92
const SIMILARITY_NGRAM_SIZE = 2
export const JSON_SEARCH_ESCAPE_CHAR = '#'
const SIMILARITY_IGNORED_CHARS = /[\s.,，。;；:：!?！？'"“”‘’`´_\-—–~·、/\\|()[\]{}<>《》【】「」『』…]+/gu

export function normalizePrompt(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function normalizePromptForSimilarity(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(SIMILARITY_IGNORED_CHARS, '')
}

export function promptSimilarity(left, right) {
  const normalizedLeft = normalizePromptForSimilarity(left)
  const normalizedRight = normalizePromptForSimilarity(right)
  if (normalizedLeft === normalizedRight) return normalizedLeft ? 100 : 0
  if (!normalizedLeft || !normalizedRight) return 0

  const gramSize = Math.min(SIMILARITY_NGRAM_SIZE, normalizedLeft.length, normalizedRight.length)
  const leftGrams = createNGramCounts(normalizedLeft, gramSize)
  const rightGrams = createNGramCounts(normalizedRight, gramSize)
  const leftTotal = countNGrams(leftGrams)
  const rightTotal = countNGrams(rightGrams)
  if (leftTotal === 0 || rightTotal === 0) return 0

  let intersection = 0
  for (const [gram, count] of leftGrams) {
    intersection += Math.min(count, rightGrams.get(gram) || 0)
  }

  return (2 * intersection * 100) / (leftTotal + rightTotal)
}

export function findSimilarPromptGroups(rows, threshold = DEFAULT_SIMILARITY_THRESHOLD) {
  const similarityThreshold = normalizeSimilarityThreshold(threshold, '--similar-threshold')
  const items = rows
    .map((row, index) => ({
      index,
      row,
      normalizedPrompt: normalizePromptForSimilarity(row?.prompt)
    }))
    .filter((item) => item.normalizedPrompt)

  const parent = items.map((_, index) => index)
  const pairs = []

  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      const similarity = promptSimilarity(items[leftIndex].row.prompt, items[rightIndex].row.prompt)
      if (similarity >= similarityThreshold) {
        unionParents(parent, leftIndex, rightIndex)
        pairs.push({ leftIndex, rightIndex, similarity: roundSimilarity(similarity) })
      }
    }
  }

  if (pairs.length === 0) return []

  const grouped = new Map()
  for (let index = 0; index < items.length; index += 1) {
    const root = findParent(parent, index)
    if (!grouped.has(root)) grouped.set(root, [])
    grouped.get(root).push(index)
  }

  const pairGroups = new Map()
  for (const pair of pairs) {
    const root = findParent(parent, pair.leftIndex)
    if (!pairGroups.has(root)) pairGroups.set(root, [])
    pairGroups.get(root).push(pair)
  }

  const groups = []
  for (const [root, indices] of grouped) {
    if (!pairGroups.has(root) || indices.length < 2) continue

    const members = indices.map((index) => items[index].row)
    const keeper = selectKeeper(members)
    if (!keeper) continue

    const duplicates = members
      .filter((member) => member.id !== keeper.id)
      .map((member) => ({
        row: member,
        similarity: roundSimilarity(promptSimilarity(keeper.prompt, member.prompt))
      }))
      .filter((match) => match.similarity >= similarityThreshold)
      .sort((left, right) => String(left.row.id || '').localeCompare(String(right.row.id || '')))

    if (duplicates.length === 0) continue

    groups.push({
      keeper,
      members,
      duplicates,
      pairCount: pairGroups.get(root).length,
      pairs: pairGroups.get(root).map((pair) => ({
        leftId: items[pair.leftIndex].row.id,
        rightId: items[pair.rightIndex].row.id,
        similarity: pair.similarity
      }))
    })
  }

  return groups.sort((left, right) => String(left.keeper.id || '').localeCompare(String(right.keeper.id || '')))
}

export function selectKeeper(rows) {
  const sorted = [...rows].sort(compareKeeperRows)
  return sorted[0] || null
}

export function compareKeeperRows(left, right) {
  const leftPublished = left?.reviewStatus === 'PUBLISHED' ? 1 : 0
  const rightPublished = right?.reviewStatus === 'PUBLISHED' ? 1 : 0
  if (leftPublished !== rightPublished) return rightPublished - leftPublished

  const leftFavorites = Number(left?.favoriteCount || 0)
  const rightFavorites = Number(right?.favoriteCount || 0)
  if (leftFavorites !== rightFavorites) return rightFavorites - leftFavorites

  const leftCreated = new Date(left?.createdAt || 0).getTime()
  const rightCreated = new Date(right?.createdAt || 0).getTime()
  if (leftCreated !== rightCreated) return rightCreated - leftCreated

  return String(right?.id || '').localeCompare(String(left?.id || ''))
}

export function referenceStoragePaths(value) {
  const parsed = typeof value === 'string' ? safeJsonParse(value, []) : value
  if (!Array.isArray(parsed)) return []

  return parsed
    .map((image) => typeof image?.storagePath === 'string' ? image.storagePath.trim() : '')
    .filter(Boolean)
}

export function uniqueStoragePaths(...groups) {
  const paths = new Set()
  for (const group of groups) {
    for (const value of Array.isArray(group) ? group : []) {
      const storagePath = typeof value === 'string' ? value : value?.storagePath
      if (typeof storagePath === 'string' && storagePath.trim()) {
        paths.add(storagePath.trim())
      }
    }
  }
  return [...paths]
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  loadDotEnv(path.resolve(cwd, options.envFile))

  const PrismaClient = await loadPrismaClient()
  const prisma = new PrismaClient()
  const storage = getStorageConfig()
  const reporter = await createReporter(options)
  const summary = createSummary(options, storage, reporter)

  try {
    if (options.execute && storage.driver === 'r2') {
      requireR2Config(storage.r2)
    }

    console.log(`Mode: ${options.execute ? 'execute' : 'dry-run'}`)
    console.log(`Similar prompts: ${options.similarPrompts ? `enabled at ${options.similarityThreshold}%` : 'disabled'}`)
    console.log(`Group batch size: ${options.groupBatchSize}`)
    console.log(`Delete concurrency: ${options.deleteConcurrency}`)
    console.log(`Report: ${reporter.eventsPath}`)
    if (!options.execute) {
      console.log('Dry run only. Re-run with --execute to delete database rows and storage objects.')
    }

    await cleanupDuplicatePrompts(prisma, storage, reporter, summary, options)
  } finally {
    summary.finishedAt = new Date().toISOString()
    await reporter.close(summary)
    await prisma.$disconnect()
  }

  printSummary(summary, reporter)
  if (summary.databaseDeleteFailures > 0 || summary.storageDeleteFailures > 0) {
    process.exitCode = 1
  }
}

async function cleanupDuplicatePrompts(prisma, storage, reporter, summary, options) {
  if (options.similarPrompts) {
    await cleanupSimilarPromptDuplicates(prisma, storage, reporter, summary, options)
    return
  }

  await cleanupExactPromptDuplicates(prisma, storage, reporter, summary, options)
}

async function cleanupExactPromptDuplicates(prisma, storage, reporter, summary, options) {
  let lastPromptKey = ''

  while (true) {
    const keys = await findDuplicatePromptKeys(prisma, lastPromptKey, options.groupBatchSize)
    if (keys.length === 0) break

    for (const row of keys) {
      const promptKey = String(row.promptKey || '')
      if (!promptKey) continue

      lastPromptKey = promptKey
      if (options.maxGroups > 0 && summary.promptGroupsProcessed >= options.maxGroups) return
      await processPromptKey(prisma, storage, reporter, summary, options, promptKey, row.promptGroupCount)
    }
  }
}

async function cleanupSimilarPromptDuplicates(prisma, storage, reporter, summary, options) {
  const rows = await findImageSetsForSimilarPrompts(prisma)
  const groups = findSimilarPromptGroups(rows, options.similarityThreshold)

  for (const group of groups) {
    if (options.maxGroups > 0 && summary.similarPromptGroupsProcessed >= options.maxGroups) return
    const shouldContinue = await processSimilarPromptGroup(prisma, storage, reporter, summary, options, group)
    if (!shouldContinue) return
  }
}

async function processSimilarPromptGroup(prisma, storage, reporter, summary, options, group) {
  summary.promptGroupsProcessed += 1
  summary.similarPromptGroupsProcessed += 1
  summary.similarPromptPairsMatched += group.pairCount

  reporter.write('similar_prompt_group', {
    similarityThreshold: options.similarityThreshold,
    groupSize: group.members.length,
    pairCount: group.pairCount,
    directDuplicateCount: group.duplicates.length,
    keeper: summarizeImageSet(group.keeper),
    duplicates: group.duplicates.map((match) => ({
      ...summarizeImageSet(match.row),
      similarity: match.similarity,
      promptLength: promptLength(match.row.prompt),
      promptPreview: promptPreview(match.row.prompt)
    })),
    pairs: group.pairs
  })

  let nextIndex = 0
  while (nextIndex < group.duplicates.length) {
    const duplicateLimit = remainingDuplicateLimit(options, summary)
    if (duplicateLimit === 0) return false

    const batchSize = Math.min(options.deleteConcurrency, duplicateLimit, group.duplicates.length - nextIndex)
    const batch = group.duplicates.slice(nextIndex, nextIndex + batchSize)
    nextIndex += batchSize

    await Promise.all(batch.map((match) => (
      processDuplicateImageSet(prisma, storage, reporter, summary, options, group.keeper, match.row, {
        matchType: 'similar',
        similarity: match.similarity,
        similarityThreshold: options.similarityThreshold
      })
    )))

    if (options.pauseMs > 0) await sleep(options.pauseMs)
  }

  return true
}

async function processPromptKey(prisma, storage, reporter, summary, options, promptKey, promptGroupCount) {
  const keeper = await findKeeperForPromptKey(prisma, promptKey)
  if (!keeper) return

  const normalizedPrompt = normalizePrompt(keeper.prompt)
  summary.promptGroupsProcessed += 1
  reporter.write('prompt_group', {
    promptKey,
    promptGroupCount: toNumber(promptGroupCount),
    keeper: summarizeImageSet(keeper),
    normalizedPrompt
  })

  let lastDuplicateId = ''
  while (true) {
    const duplicateLimit = remainingDuplicateLimit(options, summary)
    if (duplicateLimit === 0) return

    const duplicates = await findNextDuplicatesForPromptKey(
      prisma,
      promptKey,
      keeper.id,
      lastDuplicateId,
      Math.min(options.deleteConcurrency, duplicateLimit)
    )
    if (duplicates.length === 0) break
    lastDuplicateId = duplicates[duplicates.length - 1].id

    const processableDuplicates = []
    for (const duplicate of duplicates) {
      const duplicatePrompt = normalizePrompt(duplicate.prompt)
      if (duplicatePrompt === normalizedPrompt) {
        processableDuplicates.push(duplicate)
        continue
      }

      summary.promptHashCollisionsSkipped += 1
      reporter.write('skip_hash_collision', {
        promptKey,
        keeper: summarizeImageSet(keeper),
        duplicate: summarizeImageSet(duplicate)
      })
    }

    if (processableDuplicates.length > 0) {
      await Promise.all(processableDuplicates.map((duplicate) => (
        processDuplicateImageSet(prisma, storage, reporter, summary, options, keeper, duplicate)
      )))
      if (options.pauseMs > 0) await sleep(options.pauseMs)
    }
  }
}

async function processDuplicateImageSet(prisma, storage, reporter, summary, options, keeper, duplicate, match = null) {
  const images = await prisma.imageFile.findMany({
    where: { imageSetId: duplicate.id },
    select: { storagePath: true, size: true }
  })
  const storagePaths = uniqueStoragePaths(images, referenceStoragePaths(duplicate.referenceImages))
  const imageBytes = images.reduce((sum, image) => sum + Number(image.size || 0), 0)

  summary.duplicateImageSetsFound += 1
  summary.imageFileBytesFound += imageBytes
  summary.storagePathCandidatesFound += storagePaths.length

  const event = {
    keeper: summarizeImageSet(keeper),
    duplicate: summarizeImageSet(duplicate),
    imageFileCount: images.length,
    storagePathCount: storagePaths.length,
    imageFileBytes: imageBytes,
    storagePaths,
    ...summarizeDuplicateMatch(match, keeper, duplicate)
  }

  if (!options.execute) {
    reporter.write('dry_run_delete_image_set', event)
    return
  }

  try {
    await prisma.imageSet.delete({ where: { id: duplicate.id } })
    summary.imageSetsDeleted += 1
    reporter.write('delete_image_set', event)
  } catch (error) {
    summary.databaseDeleteFailures += 1
    reporter.write('database_delete_failed', {
      ...event,
      error: errorMessage(error)
    })
    return
  }

  for (const storagePath of storagePaths) {
    await deleteStoragePathIfUnused(prisma, storage, reporter, summary, duplicate.id, storagePath)
  }
}

async function deleteStoragePathIfUnused(prisma, storage, reporter, summary, deletedImageSetId, storagePath) {
  try {
    if (await isStoragePathReferenced(prisma, storagePath)) {
      summary.storageDeleteSkippedReferenced += 1
      reporter.write('skip_storage_still_referenced', { imageSetId: deletedImageSetId, storagePath })
      return
    }

    const result = await deleteStorageObject(storage, storagePath)
    if (result === 'missing') {
      summary.storageObjectsMissing += 1
      reporter.write('storage_object_missing', { imageSetId: deletedImageSetId, storagePath })
      return
    }

    summary.storageObjectsDeleted += 1
    reporter.write('delete_storage_object', { imageSetId: deletedImageSetId, storagePath })
  } catch (error) {
    summary.storageDeleteFailures += 1
    reporter.write('storage_delete_failed', {
      imageSetId: deletedImageSetId,
      storagePath,
      error: errorMessage(error)
    })
  }
}

async function findDuplicatePromptKeys(prisma, lastPromptKey, limit) {
  return prisma.$queryRaw`
    SELECT promptKey, COUNT(*) AS promptGroupCount
    FROM (
      SELECT SHA2(LOWER(REGEXP_REPLACE(TRIM(prompt), '[[:space:]]+', ' ')), 256) AS promptKey
      FROM ImageSet
    ) normalized
    WHERE promptKey > ${lastPromptKey}
    GROUP BY promptKey
    HAVING COUNT(*) > 1
    ORDER BY promptKey ASC
    LIMIT ${limit}
  `
}

async function findKeeperForPromptKey(prisma, promptKey) {
  const rows = await prisma.$queryRaw`
    SELECT
      image_set.id,
      image_set.prompt,
      image_set.reviewStatus,
      image_set.createdAt,
      image_set.referenceImages,
      COALESCE(favorite_counts.favoriteCount, 0) AS favoriteCount
    FROM ImageSet image_set
    LEFT JOIN (
      SELECT imageSetId, COUNT(*) AS favoriteCount
      FROM ImageFavorite
      GROUP BY imageSetId
    ) favorite_counts ON favorite_counts.imageSetId = image_set.id
    WHERE SHA2(LOWER(REGEXP_REPLACE(TRIM(image_set.prompt), '[[:space:]]+', ' ')), 256) = ${promptKey}
    ORDER BY
      CASE WHEN image_set.reviewStatus = 'PUBLISHED' THEN 0 ELSE 1 END ASC,
      COALESCE(favorite_counts.favoriteCount, 0) DESC,
      image_set.createdAt DESC,
      image_set.id DESC
    LIMIT 1
  `
  return rows[0] || null
}

async function findNextDuplicatesForPromptKey(prisma, promptKey, keeperId, lastDuplicateId, limit) {
  return prisma.$queryRaw`
    SELECT
      image_set.id,
      image_set.prompt,
      image_set.reviewStatus,
      image_set.createdAt,
      image_set.referenceImages
    FROM ImageSet image_set
    WHERE SHA2(LOWER(REGEXP_REPLACE(TRIM(image_set.prompt), '[[:space:]]+', ' ')), 256) = ${promptKey}
      AND image_set.id <> ${keeperId}
      AND image_set.id > ${lastDuplicateId}
    ORDER BY image_set.id ASC
    LIMIT ${limit}
  `
}

async function findImageSetsForSimilarPrompts(prisma) {
  return prisma.$queryRaw`
    SELECT
      image_set.id,
      image_set.prompt,
      image_set.reviewStatus,
      image_set.createdAt,
      image_set.referenceImages,
      COALESCE(favorite_counts.favoriteCount, 0) AS favoriteCount
    FROM ImageSet image_set
    LEFT JOIN (
      SELECT imageSetId, COUNT(*) AS favoriteCount
      FROM ImageFavorite
      GROUP BY imageSetId
    ) favorite_counts ON favorite_counts.imageSetId = image_set.id
    ORDER BY image_set.id ASC
  `
}

async function isStoragePathReferenced(prisma, storagePath) {
  const imageFileCount = await prisma.imageFile.count({ where: { storagePath } })
  if (imageFileCount > 0) return true

  const referenceRows = await prisma.$queryRaw`
    SELECT COUNT(*) AS total
    FROM ImageSet
    WHERE JSON_SEARCH(referenceImages, 'one', ${escapeJsonSearchLike(storagePath)}, '#', '$[*].storagePath') IS NOT NULL
  `
  return toNumber(referenceRows[0]?.total) > 0
}

async function deleteStorageObject(storage, storagePath) {
  const key = normalizeStoragePath(storagePath)
  if (storage.driver === 'local') {
    const file = resolveLocalStoragePath(storage.localRoot, key)
    let missing = false
    await unlink(file).catch((error) => {
      if (error?.code === 'ENOENT') {
        missing = true
        return
      }
      throw error
    })
    return missing ? 'missing' : 'deleted'
  }

  return deleteS3Object(storage.r2, key)
    .then(() => 'deleted')
    .catch((error) => {
      if (error?.statusCode === 404) return 'missing'
      throw error
    })
}

function getStorageConfig() {
  const driver = String(process.env.IMAGE_STORAGE_DRIVER || 'r2').trim().toLowerCase() === 'local' ? 'local' : 'r2'
  return {
    driver,
    localRoot: path.resolve(cwd, process.env.IMAGE_STORAGE_DIR || 'storage/images'),
    r2: {
      endpoint: firstEnv('R2_ENDPOINT', 'CLOUDFLARE_R2_ENDPOINT', 'S3_ENDPOINT'),
      accountId: firstEnv('R2_ACCOUNT_ID', 'CLOUDFLARE_R2_ACCOUNT_ID', 'S3_ACCOUNT_ID'),
      bucket: firstEnv('R2_BUCKET', 'CLOUDFLARE_R2_BUCKET', 'S3_BUCKET'),
      accessKeyId: firstEnv('R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID', 'S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID'),
      secretAccessKey: firstEnv('R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'S3_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY'),
      region: firstEnv('R2_REGION', 'CLOUDFLARE_R2_REGION', 'S3_REGION', 'AWS_REGION') || 'auto'
    }
  }
}

function requireR2Config(config) {
  const missing = []
  if (!config.endpoint && !config.accountId) missing.push('R2_ENDPOINT or R2_ACCOUNT_ID')
  if (!config.bucket) missing.push('R2_BUCKET')
  if (!config.accessKeyId) missing.push('R2_ACCESS_KEY_ID')
  if (!config.secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY')
  if (missing.length > 0) {
    throw new Error(`Missing env for R2 cleanup: ${missing.join(', ')}`)
  }
}

async function createReporter(options) {
  const reportDir = path.resolve(cwd, options.reportDir)
  await mkdir(reportDir, { recursive: true })

  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const eventsPath = path.join(reportDir, `cleanup-duplicate-prompts-${runId}.jsonl`)
  const summaryPath = path.join(reportDir, `cleanup-duplicate-prompts-${runId}.summary.json`)
  const stream = createWriteStream(eventsPath, { encoding: 'utf8' })

  return {
    eventsPath,
    summaryPath,
    write(type, payload) {
      stream.write(`${JSON.stringify({ type, at: new Date().toISOString(), ...payload })}\n`)
    },
    async close(summary) {
      await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
      stream.end()
      await once(stream, 'finish')
    }
  }
}

function createSummary(options, storage, reporter) {
  return {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    mode: options.execute ? 'execute' : 'dry-run',
    similarPromptsEnabled: options.similarPrompts,
    similarityThreshold: options.similarityThreshold,
    groupBatchSize: options.groupBatchSize,
    deleteConcurrency: options.deleteConcurrency,
    maxGroups: options.maxGroups,
    maxDeletes: options.maxDeletes,
    pauseMs: options.pauseMs,
    storageDriver: storage.driver,
    reportEventsPath: reporter.eventsPath,
    reportSummaryPath: reporter.summaryPath,
    promptGroupsProcessed: 0,
    duplicateImageSetsFound: 0,
    imageSetsDeleted: 0,
    imageFileBytesFound: 0,
    storagePathCandidatesFound: 0,
    storageObjectsDeleted: 0,
    storageObjectsMissing: 0,
    storageDeleteSkippedReferenced: 0,
    databaseDeleteFailures: 0,
    storageDeleteFailures: 0,
    promptHashCollisionsSkipped: 0,
    similarPromptGroupsProcessed: 0,
    similarPromptPairsMatched: 0
  }
}

export function parseArgs(args) {
  const options = {
    execute: false,
    envFile: '.env',
    groupBatchSize: DEFAULT_GROUP_BATCH_SIZE,
    deleteConcurrency: DEFAULT_DELETE_CONCURRENCY,
    similarPrompts: false,
    similarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
    reportDir: 'storage/cleanup-reports',
    maxGroups: 0,
    maxDeletes: 0,
    pauseMs: 0,
    help: false
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--execute') {
      options.execute = true
    } else if (arg === '--similar-prompts') {
      options.similarPrompts = true
    } else if (arg === '--similar-threshold') {
      options.similarityThreshold = normalizeSimilarityThreshold(requireValue(args, ++index, arg), arg)
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--env-file') {
      options.envFile = requireValue(args, ++index, arg)
    } else if (arg === '--batch-size' || arg === '--group-batch-size') {
      options.groupBatchSize = parsePositiveInt(requireValue(args, ++index, arg), arg)
    } else if (arg === '--delete-concurrency') {
      options.deleteConcurrency = parsePositiveInt(requireValue(args, ++index, arg), arg)
    } else if (arg === '--report-dir') {
      options.reportDir = requireValue(args, ++index, arg)
    } else if (arg === '--max-groups') {
      options.maxGroups = parseNonNegativeInt(requireValue(args, ++index, arg), arg)
    } else if (arg === '--max-deletes') {
      options.maxDeletes = parseNonNegativeInt(requireValue(args, ++index, arg), arg)
    } else if (arg === '--pause-ms') {
      options.pauseMs = parseNonNegativeInt(requireValue(args, ++index, arg), arg)
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }

  return options
}

function requireValue(args, index, name) {
  const value = args[index]
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function parsePositiveInt(value, name) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function parseNonNegativeInt(value, name) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return parsed
}

function printHelp() {
  console.log(`Usage: pnpm cleanup:duplicate-prompts -- [options]

Options:
  --execute              Delete duplicate ImageSet rows and unused storage objects.
  --similar-prompts      Enable similar-prompt duplicate detection. Defaults to exact prompt matching.
  --similar-threshold <n>
                         Similar-prompt threshold percentage. Defaults to ${DEFAULT_SIMILARITY_THRESHOLD}.
  --env-file <path>      Env file to load. Defaults to .env.
  --batch-size <n>       Duplicate prompt-key batch size. Defaults to ${DEFAULT_GROUP_BATCH_SIZE}.
  --delete-concurrency <n>
                         Duplicate image sets to process concurrently inside each prompt group.
                         Defaults to ${DEFAULT_DELETE_CONCURRENCY}.
  --max-groups <n>       Stop after n duplicate prompt groups. 0 means no limit.
  --max-deletes <n>      Stop after n duplicate image sets. 0 means no limit.
  --pause-ms <n>         Sleep after each duplicate batch. With concurrency 1 this is
                         between duplicate image-set deletes. Defaults to 0.
  --report-dir <path>    Report directory. Defaults to storage/cleanup-reports.
  --help                 Show this help.

Without --execute it only writes a dry-run report.`)
}

function printSummary(summary, reporter) {
  console.log('Done.')
  console.log(`Similar prompts enabled: ${summary.similarPromptsEnabled}`)
  console.log(`Similarity threshold: ${summary.similarityThreshold}%`)
  console.log(`Prompt groups processed: ${summary.promptGroupsProcessed}`)
  console.log(`Similar prompt groups processed: ${summary.similarPromptGroupsProcessed}`)
  console.log(`Similar prompt pairs matched: ${summary.similarPromptPairsMatched}`)
  console.log(`Duplicate image sets found: ${summary.duplicateImageSetsFound}`)
  console.log(`Image sets deleted: ${summary.imageSetsDeleted}`)
  console.log(`Image file bytes found: ${summary.imageFileBytesFound}`)
  console.log(`Storage candidates found: ${summary.storagePathCandidatesFound}`)
  console.log(`Storage objects deleted: ${summary.storageObjectsDeleted}`)
  console.log(`Storage objects already missing: ${summary.storageObjectsMissing}`)
  console.log(`Storage delete skipped as still referenced: ${summary.storageDeleteSkippedReferenced}`)
  console.log(`Database delete failures: ${summary.databaseDeleteFailures}`)
  console.log(`Storage delete failures: ${summary.storageDeleteFailures}`)
  console.log(`Events report: ${reporter.eventsPath}`)
  console.log(`Summary report: ${reporter.summaryPath}`)
}

function summarizeImageSet(row) {
  return {
    id: row.id,
    reviewStatus: row.reviewStatus,
    favoriteCount: toNumber(row.favoriteCount),
    createdAt: row.createdAt?.toISOString?.() || row.createdAt || null,
    promptPreview: String(row.prompt || '').slice(0, 120)
  }
}

function summarizeDuplicateMatch(match, keeper, duplicate) {
  if (!match) return {}

  return {
    matchType: match.matchType,
    similarity: roundSimilarity(match.similarity),
    similarityThreshold: match.similarityThreshold,
    keeperPromptLength: promptLength(keeper.prompt),
    keeperPromptPreview: promptPreview(keeper.prompt),
    duplicatePromptLength: promptLength(duplicate.prompt),
    duplicatePromptPreview: promptPreview(duplicate.prompt)
  }
}

function promptLength(prompt) {
  return String(prompt || '').length
}

function promptPreview(prompt) {
  return String(prompt || '').slice(0, 120)
}

function normalizeStoragePath(storagePath) {
  const normalized = String(storagePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const segments = normalized.split('/')
  if (!normalized || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Invalid storage path: ${storagePath}`)
  }
  return normalized
}

function resolveLocalStoragePath(root, storagePath) {
  const file = path.resolve(root, storagePath)
  if (!file.startsWith(`${root}${path.sep}`) && file !== root) {
    throw new Error(`Invalid local storage path: ${storagePath}`)
  }
  return file
}

export function escapeJsonSearchLike(value, escapeChar = JSON_SEARCH_ESCAPE_CHAR) {
  const escapedEscapeChar = escapeRegExp(escapeChar)
  return String(value)
    .replace(new RegExp(escapedEscapeChar, 'g'), `${escapeChar}${escapeChar}`)
    .replace(/%/g, `${escapeChar}%`)
    .replace(/_/g, `${escapeChar}_`)
}

function escapeRegExp(value) {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

function createNGramCounts(value, gramSize) {
  const counts = new Map()
  const text = String(value || '')
  if (!text) return counts
  const size = Math.max(1, Math.min(gramSize, text.length))

  for (let index = 0; index <= text.length - size; index += 1) {
    const gram = text.slice(index, index + size)
    counts.set(gram, (counts.get(gram) || 0) + 1)
  }

  return counts
}

function countNGrams(counts) {
  let total = 0
  for (const count of counts.values()) total += count
  return total
}

function findParent(parent, index) {
  let root = index
  while (parent[root] !== root) root = parent[root]

  while (parent[index] !== index) {
    const next = parent[index]
    parent[index] = root
    index = next
  }

  return root
}

function unionParents(parent, left, right) {
  const leftRoot = findParent(parent, left)
  const rightRoot = findParent(parent, right)
  if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot
}

function roundSimilarity(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

function normalizeSimilarityThreshold(value, name) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`${name} must be a number between 0 and 100`)
  }
  return parsed
}

function remainingDuplicateLimit(options, summary) {
  if (options.maxDeletes <= 0) return Infinity
  return Math.max(options.maxDeletes - summary.duplicateImageSetsFound, 0)
}

function toNumber(value) {
  if (typeof value === 'bigint') return Number(value)
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
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

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return ''
}

async function loadPrismaClient() {
  try {
    const prismaPackage = await import('@prisma/client')
    const PrismaClient = prismaPackage.PrismaClient || prismaPackage.default?.PrismaClient
    if (!PrismaClient) throw new Error('PrismaClient export was not found')
    return PrismaClient
  } catch (error) {
    if (String(error?.message || '').includes('.prisma/client')) {
      throw new Error('Prisma client is not generated. Run pnpm db:generate before executing cleanup.')
    }
    throw error
  }
}

function errorMessage(error) {
  return error?.message || String(error)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(errorMessage(error))
    process.exitCode = 1
  })
}
