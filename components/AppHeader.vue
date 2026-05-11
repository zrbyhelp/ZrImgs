<template>
  <header class="site-header" :class="{ 'is-scrolled': scrolled }">
    <div class="header-panel">
      <div class="brand">
        <img class="brand-logo" src="/logo.png" alt="">
        <span>{{ config.public.appName }}</span>
      </div>

      <form class="header-search" role="search" @submit.prevent="submitSearch">
        <input
          v-model="searchDraft"
          class="header-search__input"
          type="search"
          placeholder="搜索提示词或 ID"
          aria-label="搜索提示词或 ID"
        >
        <button class="icon-button header-search__button" type="submit" title="搜索">
          <Search :size="17" />
        </button>
      </form>

      <div class="header-actions">
        <div class="density-control feed-sort-control" role="group" aria-label="排序方式">
          <button
            v-for="option in feedSortOptions"
            :key="option.value"
            class="density-control__button"
            :class="{ 'is-active': galleryFeedSort === option.value }"
            type="button"
            :title="option.title"
            :aria-pressed="galleryFeedSort === option.value"
            @click="galleryFeedSort = option.value"
          >
            {{ option.label }}
          </button>
        </div>
        <div class="density-control" role="group" aria-label="列表密度">
          <button
            v-for="option in densityOptions"
            :key="option.value"
            class="density-control__button"
            :class="{ 'is-active': galleryDensity === option.value }"
            type="button"
            :title="option.title"
            :aria-pressed="galleryDensity === option.value"
            @click="galleryDensity = option.value"
          >
            {{ option.label }}
          </button>
        </div>
        <button
          class="icon-button favorite-filter-button"
          :class="{ 'is-active': favoritesOnly }"
          type="button"
          :title="favoritesOnly ? '显示全部' : '只看收藏'"
          @click="favoritesOnly = !favoritesOnly"
        >
          <Heart :size="18" :fill="favoritesOnly ? 'currentColor' : 'none'" />
          <span v-if="userFavoriteCount > 0" class="header-badge">{{ userFavoriteCount }}</span>
        </button>
        <button class="icon-button" type="button" title="投诉建议" @click="feedbackOpen = true">
          <MessageSquareWarning :size="18" />
        </button>
        <button v-if="session.admin" class="icon-button" type="button" title="Token 设置" @click="adminOpen = true">
          <KeyRound :size="18" />
        </button>
        <button class="icon-button" type="button" :title="theme === 'dark' ? '亮色模式' : '暗色模式'" @click="toggleTheme">
          <Sun v-if="theme === 'dark'" :size="18" />
          <Moon v-else :size="18" />
        </button>

        <div v-if="session.user" class="popover-wrap">
          <button class="avatar-button" type="button" @click="menuOpen = !menuOpen">
            <img v-if="session.user.avatar" :src="session.user.avatar" alt="">
            <span v-else class="avatar-fallback"><UserRound :size="16" /></span>
            <span class="avatar-name">{{ session.user.name }}</span>
          </button>
          <div v-if="menuOpen" class="popover">
            <button class="text-button" type="button" @click="logout">
              <LogOut :size="16" />
              <span>退出登录</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </header>

  <div v-if="feedbackOpen" class="center-modal" @click.self="feedbackOpen = false">
    <iframe class="feedback-frame" :src="feedbackUrl" title="投诉建议" />
  </div>

  <div v-if="adminOpen" class="center-modal" @click.self="adminOpen = false">
    <AdminPanel embedded initial-panel="tokens" @close="adminOpen = false" />
  </div>
</template>

<script setup lang="ts">
import {
  Heart,
  KeyRound,
  LogOut,
  MessageSquareWarning,
  Moon,
  Search,
  Sun,
  UserRound
} from 'lucide-vue-next'

type GalleryDensity = 'regular' | 'compact' | 'dense'
type GalleryFeedSort = 'recommended' | 'latest' | 'popular'

const config = useRuntimeConfig()
const route = useRoute()
const scrolled = ref(false)
const feedbackOpen = ref(false)
const adminOpen = ref(false)
const menuOpen = ref(false)
const theme = ref<'light' | 'dark'>('light')
const session = useState<any>('session', () => ({ user: null, admin: null }))
const favoritesOnly = useState<boolean>('favoritesOnly', () => false)
const userFavoriteCount = useState<number>('userFavoriteCount', () => 0)
const searchDraft = useState<string>('gallerySearchDraft', () => '')
const searchQuery = useState<string>('gallerySearchQuery', () => '')
const galleryFeedSort = useState<GalleryFeedSort>('galleryFeedSort', () => 'recommended')
const galleryDensity = useState<GalleryDensity>('galleryDensity', () => 'regular')
const feedSortOptions = [
  { value: 'recommended', label: '推荐', title: '推荐排序' },
  { value: 'latest', label: '最新', title: '最新优先' },
  { value: 'popular', label: '热门', title: '热门优先' }
] satisfies Array<{ value: GalleryFeedSort, label: string, title: string }>
const densityOptions = [
  { value: 'regular', label: '常规', title: '常规密度' },
  { value: 'compact', label: '中高', title: '中高密度' },
  { value: 'dense', label: '超高', title: '超高密度' }
] satisfies Array<{ value: GalleryDensity, label: string, title: string }>

const feedbackUrl = computed(() => {
  const url = new URL('/feedback', config.public.zrPortalUrl)
  if (config.public.zrServiceSlug) url.searchParams.set('service_slug', config.public.zrServiceSlug)
  url.searchParams.set('embed', '1')
  return url.toString()
})

onMounted(async () => {
  initTheme()
  initGalleryFeedSort()
  initGalleryDensity()
  await refreshSession()

  if (!session.value.user && route.path === '/') {
    redirectToLogin()
  }

  const onScroll = () => {
    scrolled.value = window.scrollY > 36
  }
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
})

watch(galleryDensity, (value) => {
  if (!import.meta.client) return
  localStorage.setItem('galleryDensity', value)
})

watch(galleryFeedSort, (value) => {
  if (!import.meta.client) return
  localStorage.setItem('galleryFeedSort', value)
})

async function refreshSession() {
  const data = await $fetch('/api/session').catch(() => ({ user: null, admin: null }))
  session.value = data
}

function initTheme() {
  const routeTheme = route.query.theme === 'dark' || route.query.theme === 'light' ? route.query.theme : null
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('theme') : null
  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  theme.value = (routeTheme || stored || (systemDark ? 'dark' : 'light')) as 'light' | 'dark'
  applyTheme()
}

function initGalleryDensity() {
  const stored = localStorage.getItem('galleryDensity')
  if (isGalleryDensity(stored)) {
    galleryDensity.value = stored
  }
}

function initGalleryFeedSort() {
  const stored = localStorage.getItem('galleryFeedSort')
  if (isGalleryFeedSort(stored)) {
    galleryFeedSort.value = stored
  }
}

function isGalleryDensity(value: string | null): value is GalleryDensity {
  return value === 'regular' || value === 'compact' || value === 'dense'
}

function isGalleryFeedSort(value: string | null): value is GalleryFeedSort {
  return value === 'recommended' || value === 'latest' || value === 'popular'
}

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  localStorage.setItem('theme', theme.value)
  applyTheme()
}

function applyTheme() {
  document.documentElement.dataset.theme = theme.value
}

function submitSearch() {
  searchQuery.value = searchDraft.value.trim()
}

function redirectToLogin() {
  window.location.href = `/api/auth/login?next=${encodeURIComponent(route.fullPath || '/')}`
}

function logout() {
  window.location.href = '/api/auth/logout'
}
</script>
