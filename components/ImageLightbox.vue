<template>
  <div v-if="item" class="modal-backdrop" @click.self="$emit('close')">
    <section class="preview-stage">
      <div class="preview-toolbar">
        <button class="icon-button" type="button" title="关闭" @click="$emit('close')">
          <X :size="18" />
        </button>
        <div class="preview-nav">
          <button
            class="icon-button"
            :class="{ 'is-active': item.isFavorited }"
            type="button"
            :title="item.isFavorited ? '取消收藏' : '收藏'"
            @click="$emit('favorite', item, !item.isFavorited)"
          >
            <Heart :size="18" :fill="item.isFavorited ? 'currentColor' : 'none'" />
          </button>
          <button class="icon-button" type="button" title="下载图片" :disabled="!currentImage" @click="downloadCurrent">
            <Download :size="18" />
          </button>
          <button class="icon-button" type="button" title="上一张" :disabled="!canPrev" @click="$emit('navigate', -1)">
            <ChevronLeft :size="18" />
          </button>
          <button class="icon-button" type="button" title="下一张" :disabled="!canNext" @click="$emit('navigate', 1)">
            <ChevronRight :size="18" />
          </button>
        </div>
      </div>

      <Transition :name="slideName" mode="out-in">
        <img
          v-if="currentImage"
          :key="currentImage.url"
          class="preview-image"
          :src="currentImage.url"
          :alt="item.prompt"
          draggable="false"
          @contextmenu.prevent="downloadCurrent"
        >
      </Transition>
      <span v-if="showingReference" class="preview-kind">参照图</span>
    </section>

    <aside class="preview-info">
      <div v-if="groupThumbs.length > 1" class="prompt-group-panel">
        <div class="prompt-group-heading">
          <span>同提示词图片</span>
          <span>{{ selectedThumbNumber }} / {{ groupThumbs.length }}</span>
        </div>
        <div class="prompt-group-list">
          <button
            v-for="thumb in groupThumbs"
            :key="thumb.key"
            class="prompt-group-thumb"
            :class="{ 'is-active': thumb.isActive }"
            type="button"
            :title="thumb.title"
            :aria-pressed="thumb.isActive"
            @click="selectGeneratedImage(thumb)"
            @contextmenu.prevent="downloadImage(thumb.image, thumb.item.id || 'image')"
          >
            <img :src="thumb.image.url" :alt="thumb.item.prompt" draggable="false">
            <span v-if="thumb.item.images?.length > 1" class="prompt-group-thumb__index">{{ thumb.imageIndex + 1 }}</span>
          </button>
        </div>
      </div>

      <dl class="info-block">
        <div class="info-row">
          <dt class="info-heading">
            <span>ID</span>
            <button class="mini-icon-button" type="button" :title="copyIdDone ? '已复制' : '复制 ID'" @click="copyImageSetId">
              <Check v-if="copyIdDone" :size="14" />
              <Copy v-else :size="14" />
            </button>
          </dt>
          <dd class="id-value">{{ displayId }}</dd>
        </div>

        <div class="info-row">
          <dt class="info-heading">
            <span>提示词</span>
            <button class="mini-icon-button" type="button" :title="copyDone ? '已复制' : '复制提示词'" @click="copyPrompt">
              <Check v-if="copyDone" :size="14" />
              <Copy v-else :size="14" />
            </button>
          </dt>
          <dd>
            <p class="prompt-value" :class="{ 'is-collapsed': promptCollapsed }">{{ item.prompt }}</p>
            <button v-if="promptLong" class="prompt-toggle" type="button" @click="promptExpanded = !promptExpanded">
              {{ promptExpanded ? '收起' : '展开' }}
            </button>
          </dd>
        </div>

        <div v-if="referenceImages.length" class="info-row">
          <dt>参照图</dt>
          <dd>
            <div class="reference-grid">
              <button
                v-for="reference in referenceImages"
                :key="reference.id || reference.url"
                class="reference-thumb"
                type="button"
                title="查看参照图"
                @click="selectedReference = reference"
                @contextmenu.prevent="downloadImage(reference, reference.fileName || 'reference')"
              >
                <img :src="reference.url" :alt="reference.fileName || '参照图'" draggable="false">
              </button>
            </div>
          </dd>
        </div>

        <div class="info-row">
          <dt>图片</dt>
          <dd>{{ imageIndex + 1 }} / {{ item.images.length }}</dd>
        </div>
        <div class="info-row">
          <dt>模型</dt>
          <dd>{{ [item.apiProvider, item.apiModel].filter(Boolean).join(' / ') || '-' }}</dd>
        </div>
        <div class="info-row">
          <dt>用户</dt>
          <dd>{{ userDisplay }}</dd>
        </div>
        <div class="info-row">
          <dt>生成时间</dt>
          <dd>{{ formatDate(item.generatedAt || item.createdAt) }}</dd>
        </div>
        <div class="info-row">
          <dt>参数</dt>
          <dd><pre class="json-box">{{ JSON.stringify(item.params || {}, null, 2) }}</pre></dd>
        </div>
      </dl>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { Check, ChevronLeft, ChevronRight, Copy, Download, Heart, X } from 'lucide-vue-next'

const props = defineProps<{
  item: any | null
  groupItems?: any[]
  imageIndex: number
  canPrev: boolean
  canNext: boolean
  direction: number
}>()
const emit = defineEmits<{
  close: []
  favorite: [item: any, next: boolean]
  navigate: [direction: number]
  'select-image': [item: any, imageIndex: number]
}>()

const promptExpanded = ref(false)
const copyDone = ref(false)
const copyIdDone = ref(false)
const selectedReference = ref<any | null>(null)
const { downloadImage } = useImageDownload()

const displayId = computed(() => String(props.item?.externalId || props.item?.id || ''))
const generatedImage = computed(() => props.item?.images?.[props.imageIndex])
const activeGroupItems = computed(() => {
  const items = Array.isArray(props.groupItems) && props.groupItems.length ? props.groupItems : []
  if (items.length) return items
  return props.item ? [props.item] : []
})
const groupThumbs = computed<any[]>(() => {
  return activeGroupItems.value.flatMap((item: any) => {
    const images = Array.isArray(item?.images) ? item.images : []
    return images
      .map((image: any, imageIndex: number) => {
        if (!image?.url) return null
        const isActive = item?.id === props.item?.id && imageIndex === props.imageIndex
        return {
          key: `${item.id || 'image-set'}:${image.id || image.url}:${imageIndex}`,
          item,
          image,
          imageIndex,
          isActive,
          title: `${imageIndex + 1} / ${images.length}`
        }
      })
      .filter(Boolean) as any[]
  })
})
const selectedThumbIndex = computed(() => groupThumbs.value.findIndex((thumb: any) => thumb.isActive))
const selectedThumbNumber = computed(() => selectedThumbIndex.value >= 0 ? selectedThumbIndex.value + 1 : 1)
const referenceImages = computed(() => {
  const images = Array.isArray(props.item?.referenceImages) ? props.item.referenceImages : []
  return images.filter((image: any) => image?.url)
})
const currentImage = computed(() => selectedReference.value || generatedImage.value)
const showingReference = computed(() => Boolean(selectedReference.value))
const promptLong = computed(() => String(props.item?.prompt || '').length > 220)
const promptCollapsed = computed(() => promptLong.value && !promptExpanded.value)
const slideName = computed(() => props.direction < 0 ? 'slide-right' : 'slide-left')
const userDisplay = computed(() => {
  const user = props.item?.user || {}
  return user.name || user.username || user.account || user.email || user.id || '-'
})

watch(() => [props.item?.id, props.imageIndex], () => {
  promptExpanded.value = false
  copyDone.value = false
  copyIdDone.value = false
  selectedReference.value = null
})

onMounted(() => {
  const handler = (event: KeyboardEvent) => {
    if (!props.item) return
    if (event.key === 'ArrowLeft' && props.canPrev) emit('navigate', -1)
    if (event.key === 'ArrowRight' && props.canNext) emit('navigate', 1)
    if (event.key === 'Escape') emit('close')
  }
  window.addEventListener('keydown', handler)
  onBeforeUnmount(() => window.removeEventListener('keydown', handler))
})

async function copyPrompt() {
  const text = String(props.item?.prompt || '')
  if (!text) return
  await copyText(text)
  copyDone.value = true
  window.setTimeout(() => {
    copyDone.value = false
  }, 1200)
}

async function copyImageSetId() {
  const text = displayId.value
  if (!text) return
  await copyText(text)
  copyIdDone.value = true
  window.setTimeout(() => {
    copyIdDone.value = false
  }, 1200)
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
}

function downloadCurrent() {
  downloadImage(currentImage.value, props.item?.id || 'image')
}

function selectGeneratedImage(thumb: any) {
  selectedReference.value = null
  emit('select-image', thumb.item, thumb.imageIndex)
}

function formatDate(value?: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}
</script>
