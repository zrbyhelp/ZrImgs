export default defineNuxtConfig({
  compatibilityDate: '2026-05-04',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
    imageStorageDir: process.env.IMAGE_STORAGE_DIR || 'storage/images',
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
