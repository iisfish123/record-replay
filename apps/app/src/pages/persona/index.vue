<template>
  <div class="page">
    <div class="topbar">
      <span><span class="dot"></span>{{ isEdit ? 'PERSONA EDIT' : 'PERSONA CREATE' }}</span>
      <span @click="goBack" class="back">← 返回</span>
    </div>

    <div class="metal step">
      <div class="step-head">
        <span class="step-num">01</span>
        <span class="step-title">填写称呼与关系</span>
      </div>
      <div class="step-hint">用一个称呼或姓名标记这位亲人，并选择你们的关系</div>
      <div class="field">
        <label class="field-label">称呼 / 姓名</label>
        <input
          v-model="name"
          class="input"
          type="text"
          maxlength="20"
          placeholder="例如：爸爸、妈妈、老王"
        />
      </div>
      <div class="field">
        <label class="field-label">关系</label>
        <select v-model="relation" class="input select">
          <option value="" disabled>请选择关系</option>
          <option v-for="r in PERSONA_RELATIONS" :key="r" :value="r">{{ r }}</option>
        </select>
      </div>
    </div>

    <div class="metal step">
      <div class="step-head">
        <span class="step-num">02</span>
        <span class="step-title">上传一张正面照</span>
      </div>
      <div class="step-hint">单人正脸、光线充足效果最好</div>
      <div class="avatar-zone" @click="triggerAvatar">
        <img v-if="avatarPreview" :src="avatarPreview" alt="" />
        <div v-else class="avatar-placeholder">
          <span class="plus">+</span>
          点击选择照片
        </div>
      </div>
      <input ref="avatarInput" type="file" accept="image/*" style="display:none" @change="onAvatarChange" />
    </div>

    <div class="metal step">
      <div class="step-head">
        <span class="step-num">03</span>
        <span class="step-title">录一段 10–20 秒朗读</span>
      </div>
      <div class="step-hint">{{ recordHint }}</div>
      <button class="record-btn" :class="{ recording }" @click="toggleRecord">
        <span class="record-dot" :class="{ idle: !recording }"></span>
        <span>{{ recordBtnText }}</span>
      </button>
      <div v-if="isEdit && !tempFile" class="sample-tip">
        保留原语音样本，未重新录制则不更新
      </div>
    </div>

    <button class="btn btn-primary" :disabled="submitting" @click="onSubmit">
      {{ submitting ? '提交中…' : isEdit ? '保存修改' : '生成数字人格' }}
    </button>

    <div v-if="statusText" class="phase status-text">{{ statusText }}</div>

    <!-- 确认模态（仅创建时） -->
    <div v-if="confirmVisible" class="modal-mask">
      <div class="modal metal">
        <div class="modal-title">确认生成数字人格？</div>
        <div class="modal-body">
          生成后将基于你的录音训练专属音色。复刻音色按「音色个数」一次性计费，单个约 9.9 元。同一账号会复用已有音色，不会重复收费。
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="confirmVisible = false">再想想</button>
          <button class="btn btn-primary" @click="confirmCreate">确认生成</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { PersonaStatus } from '@record-replay/shared';
import { PERSONA_RELATIONS } from '@record-replay/shared';
import { uploadFile } from '@/api/media';
import type { PersonaInput } from '@/api/persona';
import { createPersona, getPersona, updatePersona, listPersonas } from '@/api/persona';
import { poll } from '@/utils/poll';
import { useRecorder, isSampleLongEnough, MIN_SAMPLE_SECONDS } from '@/utils/recorder';
import { useSessionStore } from '@/stores/session';
import { absoluteUrl } from '@/config';
import { toast } from '@/utils/toast';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const { recording, seconds, tempFile, start, stop } = useRecorder();

const editId = computed(() => (route.params.id as string) || '');
const isEdit = computed(() => !!editId.value);

const avatarInput = ref<HTMLInputElement | null>(null);
const avatarFile = ref<File | null>(null);
const avatarPreview = ref('');
const name = ref('');
const relation = ref('');
const submitting = ref(false);
const status = ref<PersonaStatus | ''>('');
const confirmVisible = ref(false);

const statusText = computed(() => {
  switch (status.value) {
    case 'pending':
    case 'training':
      return '▸ 正在学习他/她的声音，请稍候…';
    case 'ready':
      return '▸ 数字人格已就绪';
    case 'failed':
      return '▸ 创建失败，请重试';
    default:
      return '';
  }
});

const recordHint = computed(() => {
  if (recording.value) return `录音中 ${seconds.value}s，点击停止`;
  if (tempFile.value) return '已录制，可重录';
  if (isEdit.value) return '保留原语音样本，或重新录制';
  return '安静环境下，像平时说话一样念一段';
});

const recordBtnText = computed(() => {
  if (recording.value) return `录音中 ${seconds.value}s，点击停止`;
  if (tempFile.value) return `已录制 ${seconds.value}s，点击重录`;
  return '开始录音';
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
  if (recording.value) {
    stop();
    return;
  }
  start().catch((e: Error) => {
    toast(e.message || '录音启动失败');
  });
}

function goBack() {
  router.back();
}

function validate(): boolean {
  if (!name.value.trim()) return toast('请填写称呼或姓名'), false;
  if (!relation.value) return toast('请选择关系'), false;
  if (isEdit.value) return true;
  if (!avatarFile.value) return toast('请先选择照片'), false;
  if (!tempFile.value) return toast('请先录制语音'), false;
  if (!isSampleLongEnough(seconds.value)) {
    toast(`录音太短，请至少录 ${MIN_SAMPLE_SECONDS} 秒`);
    return false;
  }
  return true;
}

function onSubmit() {
  if (!validate()) return;
  if (isEdit.value) {
    void doUpdate();
  } else {
    confirmVisible.value = true;
  }
}

function confirmCreate() {
  confirmVisible.value = false;
  void doCreate();
}

async function doCreate() {
  submitting.value = true;
  status.value = '';
  try {
    const [avatar, voice] = await Promise.all([
      uploadFile(avatarFile.value!, 'file', avatarFile.value!.name),
      uploadFile(tempFile.value!, 'file', tempFile.value!.name),
    ]);
    const persona = await createPersona({
      name: name.value.trim(),
      relation: relation.value,
      avatarUrl: avatar.url,
      voiceSampleUrl: voice.url,
    });
    session.setPersona(persona.id);
    status.value = persona.status;

    if (persona.status !== 'ready') {
      await poll({
        fn: () => getPersona(persona.id),
        isDone: (p) => p.status === 'ready',
        isFailed: (p) => p.status === 'failed',
        intervalMs: 3000,
        timeoutMs: 180_000,
      });
    }
    status.value = 'ready';
    toast('数字人格已就绪');
    router.replace({ path: '/chat', query: { personaId: persona.id } });
  } catch (e) {
    status.value = 'failed';
    toast((e as Error).message);
  } finally {
    submitting.value = false;
  }
}

async function doUpdate() {
  submitting.value = true;
  try {
    const patch: Partial<PersonaInput> = {
      name: name.value.trim(),
      relation: relation.value,
    };
    if (avatarFile.value) {
      const avatar = await uploadFile(avatarFile.value, 'file', avatarFile.value.name);
      patch.avatarUrl = avatar.url;
    }
    if (tempFile.value) {
      const voice = await uploadFile(tempFile.value, 'file', tempFile.value.name);
      patch.voiceSampleUrl = voice.url;
    }
    await updatePersona(editId.value, patch);
    toast('已保存修改');
    // 刷新列表后返回
    await listPersonas();
    router.replace('/home');
  } catch (e) {
    toast((e as Error).message);
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  if (!isEdit.value) return;
  try {
    const p = await getPersona(editId.value);
    avatarPreview.value = absoluteUrl(p.avatarUrl);
    name.value = p.name ?? '';
    relation.value = p.relation ?? '';
  } catch (e) {
    toast((e as Error).message);
    router.replace('/home');
  }
});
</script>

<style scoped>
.back {
  cursor: pointer;
  color: var(--primary);
}
.step {
  padding: 18px;
  margin-bottom: 16px;
}
.step-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 6px;
}
.step-num {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--primary);
  border: 1px solid var(--border);
  padding: 2px 8px;
  border-radius: 6px;
}
.step-title {
  font-size: 16px;
  font-weight: 600;
}
.step-hint {
  font-size: 12px;
  color: var(--text-dim);
  margin: 4px 0 14px;
  line-height: 1.5;
}
.field {
  margin-bottom: 14px;
}
.field:last-child {
  margin-bottom: 0;
}
.field-label {
  display: block;
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.select {
  appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, var(--text-dim) 50%),
    linear-gradient(135deg, var(--text-dim) 50%, transparent 50%);
  background-position: calc(100% - 20px) center, calc(100% - 15px) center;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}
.avatar-zone {
  width: 100%;
  height: 280px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-2);
  overflow: hidden;
  cursor: pointer;
}
.avatar-zone img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar-placeholder {
  color: var(--text-faint);
  font-size: 13px;
  text-align: center;
}
.avatar-placeholder .plus {
  font-size: 32px;
  color: var(--primary);
  display: block;
  margin-bottom: 6px;
  opacity: 0.7;
}
.record-btn {
  width: 100%;
  height: 56px;
  background: var(--bg-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  cursor: pointer;
}
.record-btn.recording {
  border-color: var(--danger);
  color: var(--danger);
  background: rgba(224, 85, 74, 0.08);
  animation: pulse 1.2s infinite;
}
@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(224, 85, 74, 0.4);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(224, 85, 74, 0);
  }
}
.record-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--danger);
}
.record-dot.idle {
  background: var(--text-faint);
}
.sample-tip {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-faint);
  text-align: center;
}
.status-text {
  margin-top: 14px;
  text-align: center;
}

.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.modal {
  width: 100%;
  max-width: 340px;
  padding: 22px 20px 16px;
}
.modal-title {
  font-size: 17px;
  font-weight: 600;
  text-align: center;
  margin-bottom: 12px;
}
.modal-body {
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.7;
  margin-bottom: 18px;
}
.modal-actions {
  display: flex;
  gap: 10px;
}
.modal-actions .btn {
  flex: 1;
  height: 44px;
  font-size: 14px;
}
</style>
