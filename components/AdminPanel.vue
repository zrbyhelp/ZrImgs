<template>
  <main class="admin-shell" :class="{ 'admin-shell--embedded': embedded }">
    <section v-if="!admin" class="panel">
      <div class="panel-heading">
        <h1 class="panel-title">无管理员权限</h1>
        <button v-if="embedded" class="icon-button" type="button" title="关闭" @click="$emit('close')">
          <X :size="18" />
        </button>
      </div>
      <div class="empty-state">
        {{ session.user ? '当前账号不是管理员' : '请先登录平台后再访问后台' }}
      </div>
    </section>

    <template v-else>
      <section class="panel">
        <div class="admin-tabs">
          <button class="text-button" type="button" @click="activePanel = 'submissions'">内容审核</button>
          <button class="text-button" type="button" @click="activePanel = 'tokens'">Token</button>
          <button v-if="embedded" class="icon-button admin-close" type="button" title="关闭" @click="$emit('close')">
            <X :size="18" />
          </button>
        </div>
      </section>

      <section v-if="activePanel === 'tokens'" class="panel">
        <h2 class="panel-title">上传 Token</h2>
        <form class="form-grid" @submit.prevent="createToken">
          <div class="field">
            <label for="tokenName">名称</label>
            <input id="tokenName" v-model="tokenName" placeholder="渠道或应用名称">
          </div>
          <div class="field">
            <label for="tokenReviewRequired">审核策略</label>
            <select id="tokenReviewRequired" v-model="tokenReviewRequired">
              <option :value="true">上传后待审</option>
              <option :value="false">上传后直接发布</option>
            </select>
          </div>
          <div class="field">
            <label>&nbsp;</label>
            <button class="text-button" type="submit">创建</button>
          </div>
        </form>
        <div v-if="createdToken" class="token-once">{{ createdToken }}</div>

        <div class="admin-list" style="margin-top: 12px">
          <div v-for="token in tokens" :key="token.id" class="admin-item">
            <div class="admin-thumb"></div>
            <div>
              <p class="admin-prompt">{{ token.name }}</p>
              <div class="admin-meta">
                <span>{{ token.tokenPrefix }}...</span>
                <span>{{ token.enabled ? '启用' : '停用' }}</span>
                <span>{{ token.reviewRequired ? '上传后待审' : '直接发布' }}</span>
                <span>创建 {{ formatDate(token.createdAt) }}</span>
                <span v-if="token.lastUsedAt">使用 {{ formatDate(token.lastUsedAt) }}</span>
              </div>
            </div>
            <div class="admin-actions">
              <button class="text-button" type="button" @click="setTokenEnabled(token, !token.enabled)">
                {{ token.enabled ? '停用' : '启用' }}
              </button>
              <button class="text-button" type="button" @click="setTokenReviewRequired(token, !token.reviewRequired)">
                {{ token.reviewRequired ? '设为免审' : '设为待审' }}
              </button>
              <button class="text-button danger" type="button" @click="revokeToken(token)">删除</button>
            </div>
          </div>
          <div v-if="!tokens.length" class="empty-state">暂无 Token</div>
        </div>
      </section>

      <section v-else class="panel">
        <div class="admin-tabs">
          <button class="text-button" type="button" @click="setStatus('PENDING')">待审</button>
          <button class="text-button" type="button" @click="setStatus('PUBLISHED')">已发布</button>
          <button class="text-button" type="button" @click="setStatus('REJECTED')">已拒绝</button>
        </div>
        <div class="admin-list">
          <div v-for="item in submissions" :key="item.id" class="admin-item">
            <div class="admin-thumb">
              <img v-if="item.images?.[0]" :src="item.images[0].url" alt="">
            </div>
            <div>
              <p class="admin-prompt">{{ item.prompt }}</p>
              <div class="admin-meta">
                <span>{{ item.reviewStatus }}</span>
                <span>{{ item.source }}</span>
                <span>{{ item.apiModel || '-' }}</span>
                <span>{{ formatDate(item.createdAt) }}</span>
              </div>
            </div>
            <div class="admin-actions">
              <button class="text-button success" type="button" @click="review(item, 'PUBLISHED')">通过</button>
              <button class="text-button danger" type="button" @click="review(item, 'REJECTED')">拒绝</button>
              <button class="text-button" type="button" @click="review(item, 'PENDING')">待审</button>
            </div>
          </div>
          <div v-if="!submissions.length" class="empty-state">暂无内容</div>
        </div>
      </section>
    </template>
  </main>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  embedded?: boolean
  initialPanel?: 'submissions' | 'tokens'
}>(), {
  embedded: false,
  initialPanel: 'submissions'
})

defineEmits<{
  close: []
}>()

const session = useState<any>('session', () => ({ user: null, admin: null }))
const admin = computed(() => session.value.admin)
const activePanel = ref<'submissions' | 'tokens'>(props.initialPanel)
const tokens = ref<any[]>([])
const submissions = ref<any[]>([])
const tokenName = ref('')
const tokenReviewRequired = ref(true)
const createdToken = ref('')
const status = ref('PENDING')

onMounted(async () => {
  await refreshAdmin()
  if (admin.value) {
    await Promise.all([loadTokens(), loadSubmissions()])
  }
})

async function refreshAdmin() {
  const data = await $fetch<any>('/api/session').catch(() => ({ user: null, admin: null }))
  session.value = data
}

async function loadTokens() {
  const data = await $fetch<any>('/api/admin/tokens')
  tokens.value = data.items
}

async function createToken() {
  if (!tokenName.value.trim()) return
  const data = await $fetch<any>('/api/admin/tokens', {
    method: 'POST',
    body: { name: tokenName.value.trim(), reviewRequired: tokenReviewRequired.value }
  })
  createdToken.value = data.token
  tokenName.value = ''
  tokenReviewRequired.value = true
  await loadTokens()
}

async function setTokenEnabled(token: any, enabled: boolean) {
  await $fetch(`/api/admin/tokens/${token.id}`, { method: 'PATCH', body: { enabled } })
  await loadTokens()
}

async function setTokenReviewRequired(token: any, reviewRequired: boolean) {
  await $fetch(`/api/admin/tokens/${token.id}`, { method: 'PATCH', body: { reviewRequired } })
  await loadTokens()
}

async function revokeToken(token: any) {
  await $fetch(`/api/admin/tokens/${token.id}`, { method: 'DELETE' })
  await loadTokens()
}

async function loadSubmissions() {
  const data = await $fetch<any>('/api/admin/submissions', { query: { status: status.value } })
  submissions.value = data.items
}

async function setStatus(next: string) {
  status.value = next
  await loadSubmissions()
}

async function review(item: any, reviewStatus: string) {
  await $fetch(`/api/admin/submissions/${item.id}`, { method: 'PATCH', body: { reviewStatus } })
  await loadSubmissions()
}

function formatDate(value?: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}
</script>
