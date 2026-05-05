<template>
  <div
    class="gallery"
    :style="{
      '--gallery-columns': String(columnCount),
      '--gallery-gap': galleryGap
    }"
  >
    <TransitionGroup
      v-for="(column, columnIndex) in columns"
      :key="columnIndex"
      name="gallery-card"
      tag="div"
      class="gallery-column"
    >
      <article
        v-for="item in column"
        :key="item.id"
        class="image-card"
        :class="{ 'is-favorited': item.isFavorited }"
      >
        <button
          class="image-card__media"
          type="button"
          @click="$emit('open', item)"
          @contextmenu.prevent="downloadImage(item.images?.[0], item.id)"
        >
          <span
            v-if="item.images?.[0]"
            class="image-card__frame"
            :class="{ 'is-loaded': loaded[item.id] }"
            :style="{ aspectRatio: imageRatio(item.images[0]) }"
          >
            <span class="image-card__skeleton" />
            <img
              :src="item.images[0].url"
              :alt="item.prompt"
              loading="lazy"
              decoding="async"
              draggable="false"
              @load="loaded[item.id] = true"
            >
          </span>
          <span class="image-card__meta">
            <span class="image-card__prompt">{{ item.prompt }}</span>
            <span v-if="badgeCount(item) > 1" class="image-count">{{ badgeCount(item) }}</span>
          </span>
        </button>

        <span class="card-actions">
          <button
            class="card-action card-favorite"
            :class="{ 'is-active': item.isFavorited }"
            type="button"
            :title="item.isFavorited ? '取消收藏' : '收藏'"
            @click.stop="$emit('favorite', item, !item.isFavorited)"
          >
            <Heart :size="16" :fill="item.isFavorited ? 'currentColor' : 'none'" />
          </button>
          <button
            v-if="isAdmin"
            class="card-action card-delete"
            type="button"
            title="删除图集"
            @click.stop="$emit('delete', item)"
          >
            <Trash2 :size="16" />
          </button>
        </span>
      </article>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { Heart, Trash2 } from 'lucide-vue-next'

type GalleryDensity = 'regular' | 'compact' | 'dense'

const props = defineProps<{ items: any[] }>()
defineEmits<{
  open: [item: any]
  favorite: [item: any, next: boolean]
  delete: [item: any]
}>()

const loaded = reactive<Record<string, boolean>>({})
const viewportWidth = ref(1200)
const session = useState<any>('session', () => ({ user: null, admin: null }))
const galleryDensity = useState<GalleryDensity>('galleryDensity', () => 'regular')
const { downloadImage } = useImageDownload()
const columnCount = computed(() => columnCountForWidth(viewportWidth.value, galleryDensity.value))
const galleryGap = computed(() => {
  if (viewportWidth.value <= 560) return '6px'
  if (galleryDensity.value === 'dense') return '6px'
  if (galleryDensity.value === 'compact') return '7px'
  return '8px'
})
const columns = computed(() => buildColumns(props.items, columnCount.value))
const isAdmin = computed(() => Boolean(session.value.admin))

onMounted(() => {
  updateColumnCount()
  window.addEventListener('resize', updateColumnCount, { passive: true })
  onBeforeUnmount(() => window.removeEventListener('resize', updateColumnCount))
})

function imageRatio(image: any) {
  const width = Number(image?.width || 0)
  const height = Number(image?.height || 0)
  if (width > 0 && height > 0) return `${width} / ${height}`
  return '4 / 5'
}

function badgeCount(item: any) {
  return Number(item?.promptGroupCount || item?.images?.length || 0)
}

function buildColumns(items: any[], count: number) {
  const columnItems = Array.from({ length: count }, () => [] as any[])
  const heights = Array.from({ length: count }, () => 0)

  for (const item of items) {
    const target = shortestColumnIndex(heights)
    columnItems[target].push(item)
    heights[target] += estimatedHeight(item)
  }

  return columnItems
}

function estimatedHeight(item: any) {
  const image = item?.images?.[0]
  const width = Number(image?.width || 0)
  const height = Number(image?.height || 0)
  if (width > 0 && height > 0) return height / width
  return 1.25
}

function shortestColumnIndex(heights: number[]) {
  let target = 0
  for (let index = 1; index < heights.length; index += 1) {
    if (heights[index] < heights[target]) target = index
  }
  return target
}

function updateColumnCount() {
  viewportWidth.value = window.innerWidth
}

function columnCountForWidth(width: number, density: GalleryDensity) {
  if (width <= 560) return 2
  if (width <= 860) return density === 'regular' ? 3 : 4
  if (width <= 1180) {
    if (density === 'dense') return 6
    if (density === 'compact') return 5
    return 4
  }
  if (density === 'dense') return 7
  if (density === 'compact') return 6
  return 5
}
</script>
