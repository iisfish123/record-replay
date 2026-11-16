<template>
  <view class="page">
    <view class="section">
      <view class="label">1 · 上传一张正面照</view>
      <view class="hint">单人正脸、光线充足效果最好</view>
      <image v-if="avatarPath" class="avatar" :src="avatarPath" mode="aspectFill" @click="chooseAvatar" />
      <button v-else class="btn-ghost" @click="chooseAvatar">选择照片</button>
    </view>

    <view class="section">
      <view class="label">2 · 录一段 10–20 秒的朗读</view>
      <view class="hint">
        {{ recording ? `录音中 ${seconds}s，点击停止` : tempFilePath ? '已录制，可重录' : '安静环境下，像平时说话一样念一段' }}
      </view>
      <button class="btn-ghost" @click="toggleRecord">
        {{ recording ? '停止录音' : tempFilePath ? '重新录音' : '开始录音' }}
      </button>
    </view>

    <button class="btn-primary" :loading="submitting" :disabled="submitting" @click="onCreate">
      生成数字人格
    </button>

    <view v-if="statusText" class="status">{{ statusText }}</view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PersonaStatus } from '@record-replay/shared';
import { uploadFile } from '@/api/media';
import { createPersona, getPersona } from '@/api/persona';
import { poll } from '@/utils/poll';
import { useRecorder } from '@/utils/recorder';
import { useSessionStore } from '@/stores/session';

const session = useSessionStore();
const { recording, seconds, tempFilePath, start, stop } = useRecorder();

const avatarPath = ref('');
const submitting = ref(false);
const status = ref<PersonaStatus | ''>('');

const statusText = computed(() => {
  switch (status.value) {
    case 'pending':
    case 'training':
      return '正在学习他/她的声音，请稍候…';
    case 'ready':
      return '数字人格已就绪';
    case 'failed':
      return '创建失败，请重试';
    default:
      return '';
  }
});

function toast(title: string) {
  uni.showToast({ title, icon: 'none' });
}

function chooseAvatar() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      const paths = res.tempFilePaths as string[];
      if (paths.length) avatarPath.value = paths[0];
    },
  });
}

function toggleRecord() {
  if (recording.value) stop();
  else start();
}

async function onCreate() {
  if (!avatarPath.value) return toast('请先选择照片');
  if (!tempFilePath.value) return toast('请先录制语音');
  submitting.value = true;
  status.value = '';
  try {
    const [avatar, voice] = await Promise.all([
      uploadFile(avatarPath.value),
      uploadFile(tempFilePath.value),
    ]);
    const persona = await createPersona(avatar.url, voice.url);
    session.setPersona(persona.id);
    status.value = persona.status;

    await poll({
      fn: () => getPersona(persona.id),
      isDone: (p) => p.status === 'ready',
      isFailed: (p) => p.status === 'failed',
      intervalMs: 3000,
      timeoutMs: 180_000,
    });
    status.value = 'ready';
    toast('数字人格已就绪');
    uni.navigateTo({ url: `/pages/chat/index?personaId=${persona.id}` });
  } catch (e) {
    status.value = 'failed';
    toast((e as Error).message);
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.page {
  padding: 40rpx 40rpx 80rpx;
}
.section {
  background: #ffffff;
  border-radius: 24rpx;
  padding: 40rpx;
  margin-bottom: 32rpx;
}
.label {
  font-size: 32rpx;
  font-weight: 600;
  color: #1a1a1a;
}
.hint {
  margin: 12rpx 0 28rpx;
  font-size: 26rpx;
  color: #8a8a94;
}
.avatar {
  width: 100%;
  height: 560rpx;
  border-radius: 20rpx;
}
.btn-ghost {
  height: 92rpx;
  line-height: 92rpx;
  font-size: 30rpx;
  color: #2b6cff;
  background: #eaf1ff;
  border-radius: 20rpx;
  margin: 0;
}
.btn-primary {
  height: 96rpx;
  line-height: 96rpx;
  font-size: 32rpx;
  color: #ffffff;
  background: #2b6cff;
  border-radius: 20rpx;
}
.status {
  margin-top: 32rpx;
  text-align: center;
  font-size: 26rpx;
  color: #6a6a74;
}
</style>
