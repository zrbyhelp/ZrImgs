<template>
  <div class="gallery" :style="{ '--gallery-columns': String(columnCount) }">
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
            <span v-if="item.images?.length > 1" class="image-count">{{ item.images.length }}</span>
          </span>
        </button>

        <button
          class="card-favorite"
          :class="{ 'is-active': item.isFavorited }"
          type="button"
          :title="item.isFavorited ? '取消收藏' : '收藏'"
          @click.stop="$emit('favorite', item, !item.isFavorited)"
        >
          <Heart :size="16" :fill="item.isFavorited ? 'currentColor' : 'none'" />
        </button>
      </article>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { Heart } from 'lucide-vue-next'

const props = defineProps<{ items: any[] }>()
defineEmits<{
  open: [item: any]
  favorite: [item: any, next: boolean]
}>()

const loaded = reactive<Record<string, boolean>>({})
const columnCount = ref(5)
const { downloadImage } = useImageDownload()
const columns = computed(() => buildColumns(props.items, columnCount.value))

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
  const width = window.innerWidth
  if (width <= 560) columnCount.value = 2
  else if (width <= 860) columnCount.value = 3
  else if (width <= 1180) columnCount.value = 4
  else columnCount.value = 5
}
</script>
