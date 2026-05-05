import { createHash, createHmac } from 'node:crypto'

const EMPTY_HASH = sha256Hex('')

export function buildR2Endpoint(accountId) {
  const id = String(accountId || '').trim()
  return id ? `https://${id}.r2.cloudflarestorage.com` : ''
}

export function hasS3Config(input = {}) {
  const config = normalizeS3Config(input)
  return Boolean(config.endpoint && config.bucket && config.accessKeyId && config.secretAccessKey)
}

export function normalizeS3Config(input = {}) {
  const endpoint = trim(input.endpoint) || buildR2Endpoint(input.accountId)
  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    bucket: trim(input.bucket),
    accessKeyId: trim(input.accessKeyId),
    secretAccessKey: trim(input.secretAccessKey),
    region: trim(input.region) || 'auto'
  }
}

export async function putS3Object(input, key, body, options = {}) {
  const config = requireS3Config(input)
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const payloadHash = sha256Hex(payload)
  const headers = {
    'content-type': options.contentType || 'application/octet-stream',
    'x-amz-content-sha256': payloadHash
  }

  if (options.cacheControl) {
    headers['cache-control'] = options.cacheControl
  }

  const response = await signedS3Fetch(config, 'PUT', key, {
    body: payload,
    headers,
    payloadHash
  })

  if (!response.ok) {
    throw await buildS3Error(response, 'upload', key)
  }

  return response
}

export async function getS3Object(input, key) {
  const config = requireS3Config(input)
  const response = await signedS3Fetch(config, 'GET', key, {
    headers: { 'x-amz-content-sha256': EMPTY_HASH },
    payloadHash: EMPTY_HASH
  })

  if (!response.ok) {
    throw await buildS3Error(response, 'read', key)
  }

  return response
}

export function createPresignedS3GetUrl(input, key, options = {}) {
  const config = requireS3Config(input)
  const normalizedKey = normalizeObjectKey(key)
  const url = objectUrl(config, normalizedKey)
  const now = options.now instanceof Date ? options.now : new Date()
  const amzDate = toAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const expires = clampExpires(options.expiresIn)
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`
  const query = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${config.accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expires)],
    ['X-Amz-SignedHeaders', 'host']
  ]
  const canonicalQuery = canonicalizeQuery(query)
  const canonicalRequest = [
    'GET',
    url.pathname,
    canonicalQuery,
    `host:${url.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD'
  ].join('\n')
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n')
  const signature = hmacHex(signingKey(config.secretAccessKey, dateStamp, config.region), stringToSign)

  url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`
  return url.toString()
}

function requireS3Config(input) {
  const config = normalizeS3Config(input)
  const missing = []
  if (!config.endpoint) missing.push('R2_ENDPOINT or R2_ACCOUNT_ID')
  if (!config.bucket) missing.push('R2_BUCKET')
  if (!config.accessKeyId) missing.push('R2_ACCESS_KEY_ID')
  if (!config.secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY')

  if (missing.length > 0) {
    const error = new Error(`Cloudflare R2 storage is not configured: missing ${missing.join(', ')}`)
    error.statusCode = 500
    throw error
  }

  return config
}

async function signedS3Fetch(config, method, key, options = {}) {
  const normalizedKey = normalizeObjectKey(key)
  const url = objectUrl(config, normalizedKey)
  const requestHeaders = new Headers(options.headers || {})
  const now = new Date()
  const amzDate = toAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = options.payloadHash || EMPTY_HASH

  requestHeaders.set('x-amz-date', amzDate)
  requestHeaders.set('x-amz-content-sha256', payloadHash)

  const { canonicalHeaders, signedHeaders } = canonicalizeHeaders(requestHeaders, url)
  const canonicalRequest = [
    method,
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n')
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n')
  const signature = hmacHex(signingKey(config.secretAccessKey, dateStamp, config.region), stringToSign)

  requestHeaders.set(
    'authorization',
    [
      'AWS4-HMAC-SHA256',
      `Credential=${config.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`
    ].join(', ')
  )

  return fetch(url, {
    method,
    headers: requestHeaders,
    body: options.body
  })
}

function objectUrl(config, key) {
  const url = new URL(config.endpoint)
  const prefix = url.pathname.replace(/\/+$/, '')
  url.pathname = `${prefix}/${encodeS3Path(config.bucket)}/${encodeS3Path(key)}`
  url.search = ''
  return url
}

function canonicalizeHeaders(headers, url) {
  const values = new Map([['host', url.host]])

  for (const [name, value] of headers.entries()) {
    values.set(name.toLowerCase(), normalizeHeaderValue(value))
  }

  const names = [...values.keys()].sort()
  return {
    canonicalHeaders: names.map((name) => `${name}:${values.get(name)}\n`).join(''),
    signedHeaders: names.join(';')
  }
}

function normalizeObjectKey(key) {
  const normalized = String(key || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const segments = normalized.split('/')
  if (!normalized || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    const error = new Error('Invalid storage path')
    error.statusCode = 400
    throw error
  }
  return normalized
}

function encodeS3Path(value) {
  return String(value)
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/')
}

function canonicalizeQuery(entries) {
  return entries
    .map(([name, value]) => [encodeRfc3986(name), encodeRfc3986(value)])
    .sort(([leftName, leftValue], [rightName, rightValue]) => leftName === rightName ? leftValue.localeCompare(rightValue) : leftName.localeCompare(rightName))
    .map(([name, value]) => `${name}=${value}`)
    .join('&')
}

function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function clampExpires(value) {
  const seconds = Math.trunc(Number(value || 900))
  if (!Number.isFinite(seconds)) return 900
  return Math.min(Math.max(seconds, 1), 604800)
}

function signingKey(secret, dateStamp, region) {
  const kDate = hmacBuffer(`AWS4${secret}`, dateStamp)
  const kRegion = hmacBuffer(kDate, region)
  const kService = hmacBuffer(kRegion, 's3')
  return hmacBuffer(kService, 'aws4_request')
}

async function buildS3Error(response, action, key) {
  const text = await response.text().catch(() => '')
  const detail = text.replace(/\s+/g, ' ').trim().slice(0, 300)
  const error = new Error(`Cloudflare R2 ${action} failed for ${key}: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`)
  error.statusCode = response.status
  return error
}

function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function normalizeHeaderValue(value) {
  return String(value).trim().replace(/\s+/g, ' ')
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function hmacBuffer(key, value) {
  return createHmac('sha256', key).update(value).digest()
}

function hmacHex(key, value) {
  return createHmac('sha256', key).update(value).digest('hex')
}

function trim(value) {
  return String(value || '').trim()
}
