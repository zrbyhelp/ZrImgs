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
      <dl class="info-block">
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
          <dd>{{ item.user?.name || item.user?.account || '-' }}</dd>
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
  imageIndex: number
  canPrev: boolean
  canNext: boolean
  direction: number
}>()
const emit = defineEmits<{
  close: []
  favorite: [item: any, next: boolean]
  navigate: [direction: number]
}>()

const promptExpanded = ref(false)
const copyDone = ref(false)
const selectedReference = ref<any | null>(null)
const { downloadImage } = useImageDownload()

const generatedImage = computed(() => props.item?.images?.[props.imageIndex])
const referenceImages = computed(() => {
  const images = Array.isArray(props.item?.referenceImages) ? props.item.referenceImages : []
  return images.filter((image: any) => image?.url)
})
const currentImage = computed(() => selectedReference.value || generatedImage.value)
const showingReference = computed(() => Boolean(selectedReference.value))
const promptLong = computed(() => String(props.item?.prompt || '').length > 220)
const promptCollapsed = computed(() => promptLong.value && !promptExpanded.value)
const slideName = computed(() => props.direction < 0 ? 'slide-right' : 'slide-left')

watch(() => [props.item?.id, props.imageIndex], () => {
  promptExpanded.value = false
  copyDone.value = false
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
  copyDone.value = true
  window.setTimeout(() => {
    copyDone.value = false
  }, 1200)
}

function downloadCurrent() {
  downloadImage(currentImage.value, props.item?.id || 'image')
}

function formatDate(value?: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}
</script>
