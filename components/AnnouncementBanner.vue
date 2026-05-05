<template>
  <section v-if="visibleAnnouncements.length" class="announcement-shell" aria-label="门户公告">
    <div ref="panelRef" class="announcement-panel">
      <article
        v-for="announcement in visibleAnnouncements"
        :key="dismissKey(announcement)"
        class="announcement-item"
      >
        <div class="announcement-copy">
          <p class="announcement-title">{{ announcement.title }}</p>
          <p v-if="announcement.content" class="announcement-content">{{ announcement.content }}</p>
        </div>
        <button
          class="icon-button announcement-close"
          type="button"
          :title="`关闭：${announcement.title || '公告'}`"
          @click="dismiss(announcement)"
        >
          <X :size="16" />
        </button>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'

type Announcement = {
  id: string
  title: string
  content: string
  scope: string | null
  serviceId: string | null
  sortOrder: number | null
  createdAt: string | null
  updatedAt: string | null
}

const STORAGE_PREFIX = 'dismissedAnnouncements'
const ANNOUNCEMENT_OFFSET_VAR = '--announcement-offset'

const announcements = ref<Announcement[]>([])
const dismissedKeys = ref(new Set<string>())
const panelRef = ref<HTMLElement | null>(null)

const visibleAnnouncements = computed(() =>
  announcements.value.filter((announcement) => !dismissedKeys.value.has(dismissKey(announcement)))
)

onMounted(async () => {
  const response = await $fetch<{ announcements?: Announcement[] }>('/api/announcements').catch(() => null)
  const incoming = Array.isArray(response?.announcements) ? response.announcements : []
  dismissedKeys.value = readDismissedKeys(incoming)
  announcements.value = incoming

  await nextTick()
  updateAnnouncementOffset()
  window.addEventListener('resize', updateAnnouncementOffset)
})

watch(visibleAnnouncements, async () => {
  await nextTick()
  updateAnnouncementOffset()
}, { flush: 'post' })

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateAnnouncementOffset)
  document.documentElement.style.removeProperty(ANNOUNCEMENT_OFFSET_VAR)
})

function dismiss(announcement: Announcement) {
  const key = dismissKey(announcement)
  rememberDismissed(key)
  dismissedKeys.value = new Set([...dismissedKeys.value, key])
}

function dismissKey(announcement: Announcement) {
  return `${STORAGE_PREFIX}:${announcement.id}:${announcement.updatedAt || ''}`
}

function updateAnnouncementOffset() {
  const height = visibleAnnouncements.value.length && panelRef.value
    ? Math.ceil(panelRef.value.getBoundingClientRect().height) + 12
    : 0
  document.documentElement.style.setProperty(ANNOUNCEMENT_OFFSET_VAR, `${height}px`)
}

function readDismissedKeys(items: Announcement[]) {
  const keys = new Set<string>()

  for (const item of items) {
    const key = dismissKey(item)
    try {
      if (localStorage.getItem(key) === '1') keys.add(key)
    } catch {
      return keys
    }
  }

  return keys
}

function rememberDismissed(key: string) {
  try {
    localStorage.setItem(key, '1')
  } catch {
    // Private browsing or storage quota failures should not block dismissing in memory.
  }
}
</script>

<style scoped>
:global(.app-page) {
  padding-top: calc(64px + var(--announcement-offset, 0px));
}

.announcement-shell {
  position: fixed;
  inset: 64px 0 auto;
  z-index: 45;
  padding: 0 14px;
  pointer-events: none;
}

.announcement-panel {
  display: grid;
  gap: 8px;
  width: min(1280px, 100%);
  margin: 0 auto;
  pointer-events: auto;
}

.announcement-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  padding: 10px 10px 10px 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-strong) 92%, var(--accent) 8%);
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
}

.announcement-copy {
  min-width: 0;
}

.announcement-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
}

.announcement-content {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.45;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.announcement-close {
  width: 32px;
  min-width: 32px;
  height: 32px;
}

@media (max-width: 560px) {
  :global(.app-page) {
    padding-top: calc(60px + var(--announcement-offset, 0px));
  }

  .announcement-shell {
    inset: 60px 0 auto;
    padding: 0 8px;
  }

  .announcement-panel {
    width: 100%;
  }

  .announcement-item {
    gap: 8px;
    padding: 9px 8px 9px 10px;
  }

  .announcement-title {
    font-size: 13px;
  }

  .announcement-content {
    font-size: 12px;
  }
}
</style>
