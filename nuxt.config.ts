const localAuthBypass = readBooleanEnv(
  process.env.LOCAL_AUTH_BYPASS ?? process.env.NUXT_LOCAL_AUTH_BYPASS,
  process.env.NODE_ENV !== 'production'
)

export default defineNuxtConfig({
  compatibilityDate: '2026-05-04',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    localAuthBypass,
    imageStorageDriver: firstEnv('IMAGE_STORAGE_DRIVER', 'NUXT_IMAGE_STORAGE_DRIVER') || 'r2',
    sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
    imageStorageDir: process.env.IMAGE_STORAGE_DIR || 'storage/images',
    r2AccountId: firstEnv('R2_ACCOUNT_ID', 'CLOUDFLARE_R2_ACCOUNT_ID', 'S3_ACCOUNT_ID'),
    r2Endpoint: firstEnv('R2_ENDPOINT', 'CLOUDFLARE_R2_ENDPOINT', 'S3_ENDPOINT'),
    r2Bucket: firstEnv('R2_BUCKET', 'CLOUDFLARE_R2_BUCKET', 'S3_BUCKET'),
    r2AccessKeyId: firstEnv('R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID', 'S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID'),
    r2SecretAccessKey: firstEnv('R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'S3_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY'),
    r2Region: firstEnv('R2_REGION', 'CLOUDFLARE_R2_REGION', 'S3_REGION', 'AWS_REGION') || 'auto',
    r2SignedUrlTtlSeconds: Number(firstEnv('R2_SIGNED_URL_TTL_SECONDS', 'S3_SIGNED_URL_TTL_SECONDS') || 900),
    zrPortalUrl: process.env.ZR_PORTAL_URL || 'https://zrg.zrbyhelp.com',
    zrClientId: process.env.ZR_CLIENT_ID || '',
    zrClientSecret: process.env.ZR_CLIENT_SECRET || '',
    zrCallbackUrl: process.env.ZR_CALLBACK_URL || '',
    adminAccounts: process.env.NUXT_ADMIN_ACCOUNTS || '',
    adminEmails: process.env.NUXT_ADMIN_EMAILS || '',
    uploadMaxBytes: Number(process.env.UPLOAD_MAX_BYTES || 30 * 1024 * 1024),
    public: {
      appName: process.env.NUXT_PUBLIC_APP_NAME || 'AI图集',
      zrPortalUrl: process.env.ZR_PORTAL_URL || 'https://zrg.zrbyhelp.com',
      zrServiceSlug: process.env.ZR_SERVICE_SLUG || '',
      zrClientId: process.env.ZR_CLIENT_ID || ''
    }
  },
  app: {
    head: {
      title: 'AI图集',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'AI image gallery' }
      ]
    }
  },
  nitro: {
    routeRules: {
      '/media/**': { headers: { 'cache-control': 'private, max-age=31536000, immutable' } }
    }
  }
})

function readBooleanEnv(value: string | undefined, fallback: boolean) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function firstEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return ''
}
