<template>
  <main class="app-page">
    <div class="load-state">登录处理中</div>
  </main>
</template>

<script setup lang="ts">
const route = useRoute()

onMounted(() => {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(route.query)) {
    if (typeof value === 'string') query.set(key, value)
  }
  window.location.href = `/api/auth/callback?${query.toString()}`
})
</script>
