<script setup lang="ts">
// 全局启动：恢复 token 到请求层
import { onMounted } from 'vue';
import { setAuthToken } from '@/api/request';

onMounted(() => {
  const token = localStorage.getItem('token');
  if (token) setAuthToken(token);
});
</script>

<template>
  <router-view />
</template>

<style>
/* 全局样式在 style.css */
</style>
