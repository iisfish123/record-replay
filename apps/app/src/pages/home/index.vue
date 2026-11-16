<template>
  <div class="page">
    <div class="section">
      <div class="label">1 · 上传一张正面照</div>
      <div class="hint">单人正脸、光线充足效果最好</div>
      <img
        v-if="avatarPreview"
        class="avatar"
        :src="avatarPreview"
        @click="triggerAvatar"
      />
      <button v-else class="btn-ghost" @click="triggerAvatar">选择照片</button>
      <input
        ref="avatarInput"
        type="file"
        accept="image/*"
        style="display: none"
        @change="onAvatarChange"
      />
    </div>

    <div class="section">
      <div class="label">2 · 录一段 10–20 秒的朗读</div>
      <div class="hint">
        {{ recording ? `录音中 ${seconds}s，点击停止` : tempFile ? '已录制，可重录' : '安静环境下，像平时说话一样念一段' }}
      </div>
      <button class="btn-ghost" @click="toggleRecord">
        {{ recording ? '停止录音' : tempFile ? '重新录音' : '开始录音' }}
      </button>
    </div>

    <button class="btn-primary" :disabled="submitting" @click="onCreate">
      {{ submitting ? '生成中…' : '生成数字人格' }}
    </button>

    <div v-if="statusText" class="status">{{ statusText }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { PersonaStatus } from '@record-replay/shared';
import { uploadFile } from '@/api/media';
import { createPersona, getPersona } from '@/api/persona';
import { poll } from '@/utils/poll';
import { useRecorder } from '@/utils/recorder';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/utils/toast';

const router = useRouter();
const session = useSessionStore();
const { recording, seconds, tempFile, start, stop } = useRecorder();

const avatarInput = ref<HTMLInputElement | null>(null);
const avatarFile = ref<File | null>(null);
const avatarPreview = ref('');
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

function triggerAvatar() {
  avatarInput.value?.click();
}

function onAvatarChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  avatarFile.value = file;
  avatarPreview.value = URL.createObjectURL(file);
}

function toggleRecord() {
  if (recording.value) stop();
  else start();
}

async function onCreate() {
  if (!avatarFile.value) return toast('请先选择照片');
  if (!tempFile.value) return toast('请先录制语音');
  submitting.value = true;
  status.value = '';
  try {
    const [avatar, voice] = await Promise.all([
      uploadFile(avatarFile.value, 'file', avatarFile.value.name),
      uploadFile(tempFile.value, 'file', tempFile.value.name),
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
    router.push({ path: '/chat', query: { personaId: persona.id } });
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
  padding: 20px 20px 40px;
}
.section {
  background: #ffffff;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
}
.label {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a;
}
.hint {
  margin: 6px 0 14px;
  font-size: 13px;
  color: #8a8a94;
}
.avatar {
  width: 100%;
  height: 280px;
  border-radius: 10px;
  object-fit: cover;
  display: block;
}
.btn-ghost {
  width: 100%;
  height: 46px;
  font-size: 15px;
  color: #2b6cff;
  background: #eaf1ff;
  border-radius: 10px;
}
.btn-primary {
  width: 100%;
  height: 48px;
  font-size: 16px;
  color: #ffffff;
  background: #2b6cff;
  border-radius: 10px;
}
.btn-primary[disabled] {
  opacity: 0.6;
}
.status {
  margin-top: 16px;
  text-align: center;
  font-size: 13px;
  color: #6a6a74;
}
</style>
