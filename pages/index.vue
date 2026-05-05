<template>
  <main class="app-page">
    <div v-if="redirecting" class="empty-state">正在进入登录</div>
    <template v-else>
      <ImageMasonry :items="items" @open="openItem" @favorite="setFavorite" @delete="deleteItem" />
      <div v-if="error" class="empty-state">{{ error }}</div>
      <div v-else-if="!loading && items.length === 0" class="empty-state">{{ emptyText }}</div>
      <div ref="sentinel" class="load-state">
        <span v-if="loading">加载中</span>
        <span v-else-if="hasMore">继续滚动</span>
        <span v-else>已全部加载</span>
      </div>
      <ImageLightbox
        :item="activeItem"
        :group-items="activeGroupItems"
        :image-index="activeImageIndex"
        :can-prev="canPrev"
        :can-next="canNext"
        :direction="navDirection"
        @close="closeLightbox"
        @favorite="setFavorite"
        @navigate="navigateActive"
        @select-image="selectActiveImage"
      />
    </template>
  </main>
</template>

<script setup lang="ts">
const route = useRoute()
const session = useState<any>('session', () => ({ user: null, admin: null }))
const favoritesOnly = useState<boolean>('favoritesOnly', () => false)
const userFavoriteCount = useState<number>('userFavoriteCount', () => 0)
const searchQuery = useState<string>('gallerySearchQuery', () => '')

const items = ref<any[]>([])
const page = ref(1)
const hasMore = ref(true)
const loading = ref(false)
const redirecting = ref(false)
const error = ref('')
const activeGroupPrompt = ref<string | null>(null)
const activeGroupItemId = ref<string | null>(null)
const activeImageIndex = ref(0)
const navDirection = ref(1)
const sentinel = ref<HTMLElement | null>(null)

const activeGroupRoot = computed(() => {
  if (!activeGroupPrompt.value) return null
  return items.value.find((item) => promptGroupKey(item) === activeGroupPrompt.value) || null
})
const activeGroupItems = computed(() => groupItemsFor(activeGroupRoot.value))
const activeItem = computed(() => {
  const groupItems = activeGroupItems.value
  if (!groupItems.length) return null
  return groupItems.find((item: any) => item.id === activeGroupItemId.value) || groupItems[0] || null
})
const emptyText = computed(() => searchQuery.value ? '暂无匹配图片' : favoritesOnly.value ? '暂无收藏内容' : '暂无图片')
const canPrev = computed(() => canNavigate(-1))
const canNext = computed(() => canNavigate(1))

watch(favoritesOnly, async () => {
  closeLightbox()
  await refreshFeed()
})

watch(searchQuery, async () => {
  closeLightbox()
  await refreshFeed()
})

watch(activeGroupRoot, (item) => {
  if (!item) {
    activeGroupPrompt.value = null
    activeGroupItemId.value = null
    activeImageIndex.value = 0
    return
  }

  const groupItems = groupItemsFor(item)
  if (!groupItems.some((entry: any) => entry.id === activeGroupItemId.value)) {
    activeGroupItemId.value = groupItems[0]?.id || null
    activeImageIndex.value = 0
  }
})

watch(activeItem, (item) => {
  if (!item) return
  const imageCount = item.images?.length || 0
  if (activeImageIndex.value >= imageCount) {
    activeImageIndex.value = Math.max(imageCount - 1, 0)
  }
})

onMounted(async () => {
  if (!await ensureLogin()) return
  await loadMore()

  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) loadMore()
  }, { rootMargin: '900px 0px' })

  if (sentinel.value) observer.observe(sentinel.value)
  onBeforeUnmount(() => observer.disconnect())
})

async function ensureLogin() {
  const data = await $fetch<any>('/api/session').catch(() => ({ user: null, admin: null }))
  session.value = data

  if (!data.user) {
    redirecting.value = true
    redirectToLogin()
    return false
  }

  return true
}

async function refreshFeed() {
  page.value = 1
  hasMore.value = true
  items.value = []
  error.value = ''
  await loadMore()
}

async function loadMore() {
  if (loading.value || !hasMore.value) return
  loading.value = true
  error.value = ''

  try {
    const data = await $fetch<any>('/api/images', {
      query: {
        page: page.value,
        limit: 28,
        favorites: favoritesOnly.value ? 1 : undefined,
        q: searchQuery.value || undefined
      }
    })
    userFavoriteCount.value = Number(data.favoriteCount || 0)
    const existing = new Set(items.value.map(promptGroupKey))
    items.value.push(...data.items.filter((item: any) => !existing.has(promptGroupKey(item))))
    hasMore.value = data.hasMore
    page.value += 1
  } catch (err: any) {
    if (isUnauthorized(err)) {
      redirecting.value = true
      redirectToLogin()
      return
    }
    error.value = err?.data?.message || err?.statusMessage || '图片加载失败，请检查数据库和导入数据'
  } finally {
    loading.value = false
  }
}

async function setFavorite(item: any, next: boolean) {
  try {
    const data = await $fetch<any>(`/api/favorites/${item.id}`, {
      method: next ? 'POST' : 'DELETE'
    })
    applyFavoriteUpdate(item.id, data)
  } catch (err: any) {
    error.value = err?.data?.message || err?.statusMessage || '收藏操作失败'
  }
}

async function deleteItem(item: any) {
  if (!session.value.admin) return

  const prompt = String(item?.prompt || '').trim()
  const confirmed = window.confirm(`确定删除这个图集吗？${prompt ? `\n\n${prompt.slice(0, 120)}` : ''}`)
  if (!confirmed) return

  try {
    const data = await $fetch<any>(`/api/admin/images/${item.id}`, {
      method: 'DELETE'
    })

    if (activeGroupPrompt.value === promptGroupKey(item)) closeLightbox()
    await refreshFeed()

    if (Number(data.storageDeleteFailed || 0) > 0) {
      error.value = `图集已删除，但有 ${data.storageDeleteFailed} 个存储文件删除失败，请查看审计日志`
    }
  } catch (err: any) {
    error.value = err?.data?.message || err?.statusMessage || '删除图集失败'
  }
}

function applyFavoriteUpdate(id: string, data: any) {
  userFavoriteCount.value = Number(data.userFavoriteCount || userFavoriteCount.value)
  let changed = false

  items.value = items.value
    .map((entry) => {
      const groupItems = groupItemsFor(entry)
      if (!groupItems.some((item: any) => item.id === id)) return entry

      changed = true
      const nextGroupItems = groupItems
        .map((item: any) => {
          if (item.id !== id) return item
          return {
            ...item,
            isFavorited: Boolean(data.isFavorited),
            favoriteCount: Number(data.favoriteCount || 0)
          }
        })
        .filter((item: any) => !favoritesOnly.value || item.isFavorited)

      return promptGroupRootFromItems(nextGroupItems)
    })
    .filter(Boolean)
    .sort(compareFeedItems)

  if (!changed) return

  const groupItems = activeGroupItems.value
  if (!groupItems.length) {
    closeLightbox()
  } else if (!groupItems.some((item: any) => item.id === activeGroupItemId.value)) {
    activeGroupItemId.value = groupItems[0]?.id || null
    activeImageIndex.value = 0
  }
}

function compareFeedItems(a: any, b: any) {
  const favoriteDiff = Number(b.favoriteCount || 0) - Number(a.favoriteCount || 0)
  if (favoriteDiff !== 0) return favoriteDiff

  const createdDiff = new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  if (createdDiff !== 0) return createdDiff

  return String(b.id || '').localeCompare(String(a.id || ''))
}

function openItem(item: any) {
  activeGroupPrompt.value = promptGroupKey(item)
  activeGroupItemId.value = item.id
  activeImageIndex.value = 0
}

function closeLightbox() {
  activeGroupPrompt.value = null
  activeGroupItemId.value = null
  activeImageIndex.value = 0
}

function selectActiveImage(item: any, imageIndex: number) {
  const currentIndex = flatImageIndex(activeItem.value, activeImageIndex.value)
  const nextIndex = flatImageIndex(item, imageIndex)
  if (currentIndex >= 0 && nextIndex >= 0 && currentIndex !== nextIndex) {
    navDirection.value = nextIndex > currentIndex ? 1 : -1
  }

  activeGroupItemId.value = item.id
  activeImageIndex.value = clampImageIndex(item, imageIndex)
}

function navigateActive(direction: number) {
  const item = activeItem.value
  if (!item) return

  navDirection.value = direction
  const imageCount = item.images?.length || 0
  const nextImageIndex = activeImageIndex.value + direction
  if (nextImageIndex >= 0 && nextImageIndex < imageCount) {
    activeImageIndex.value = nextImageIndex
    return
  }

  const groupItems = activeGroupItems.value.filter(hasGeneratedImages)
  const currentGroupIndex = groupItems.findIndex((entry: any) => entry.id === item.id)
  const nextGroupIndex = currentGroupIndex + direction
  if (nextGroupIndex >= 0 && nextGroupIndex < groupItems.length) {
    const nextGroupItem = groupItems[nextGroupIndex]
    activeGroupItemId.value = nextGroupItem.id
    activeImageIndex.value = direction > 0 ? 0 : lastImageIndex(nextGroupItem)
    return
  }

  const currentIndex = items.value.findIndex((entry) => promptGroupKey(entry) === activeGroupPrompt.value)
  const nextItem = findNavigableItem(currentIndex, direction)
  if (!nextItem) return

  const nextGroupItems = groupItemsFor(nextItem.item).filter(hasGeneratedImages)
  const nextActiveItem = direction > 0 ? nextGroupItems[0] : nextGroupItems[nextGroupItems.length - 1]
  activeGroupPrompt.value = promptGroupKey(nextItem.item)
  activeGroupItemId.value = nextActiveItem.id
  activeImageIndex.value = direction > 0 ? 0 : lastImageIndex(nextActiveItem)
}

function canNavigate(direction: number) {
  const item = activeItem.value
  if (!item) return false

  const imageCount = item.images?.length || 0
  const nextImageIndex = activeImageIndex.value + direction
  if (nextImageIndex >= 0 && nextImageIndex < imageCount) return true

  const groupItems = activeGroupItems.value.filter(hasGeneratedImages)
  const currentGroupIndex = groupItems.findIndex((entry: any) => entry.id === item.id)
  const nextGroupIndex = currentGroupIndex + direction
  if (nextGroupIndex >= 0 && nextGroupIndex < groupItems.length) return true

  const currentIndex = items.value.findIndex((entry) => promptGroupKey(entry) === activeGroupPrompt.value)
  return Boolean(findNavigableItem(currentIndex, direction))
}

function findNavigableItem(currentIndex: number, direction: number) {
  if (currentIndex < 0) return null
  for (let index = currentIndex + direction; index >= 0 && index < items.value.length; index += direction) {
    if (groupItemsFor(items.value[index]).some(hasGeneratedImages)) {
      return { item: items.value[index], index }
    }
  }
  return null
}

function groupItemsFor(item: any | null) {
  if (!item) return []

  const groupItems = Array.isArray(item.promptGroupItems) && item.promptGroupItems.length
    ? item.promptGroupItems
    : [item]

  if (groupItems.some((entry: any) => entry?.id === item.id)) return groupItems
  return [item, ...groupItems]
}

function promptGroupRootFromItems(groupItems: any[]) {
  const sorted = [...groupItems].filter(Boolean).sort(compareFeedItems)
  const representative = sorted[0]
  if (!representative) return null

  return {
    ...representative,
    promptGroupCount: sorted.length,
    promptGroupItems: sorted
  }
}

function promptGroupKey(item: any) {
  return String(item?.prompt || item?.id || '')
}

function hasGeneratedImages(item: any) {
  return Boolean(item?.images?.length)
}

function lastImageIndex(item: any) {
  return Math.max((item?.images?.length || 1) - 1, 0)
}

function clampImageIndex(item: any, imageIndex: number) {
  const maxIndex = lastImageIndex(item)
  return Math.min(Math.max(Number(imageIndex || 0), 0), maxIndex)
}

function flatImageIndex(item: any | null, imageIndex: number) {
  if (!item) return -1

  let offset = 0
  for (const entry of activeGroupItems.value) {
    if (entry.id === item.id) return offset + clampImageIndex(entry, imageIndex)
    offset += entry.images?.length || 0
  }
  return -1
}

function redirectToLogin() {
  window.location.href = `/api/auth/login?next=${encodeURIComponent(route.fullPath || '/')}`
}

function isUnauthorized(err: any) {
  return err?.statusCode === 401 || err?.status === 401 || err?.response?.status === 401
}
</script>
