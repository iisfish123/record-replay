<template>
  <div class="page">
    <div class="topbar">
      <span><span class="dot"></span>PERSONA MANAGE</span>
      <span>{{ phone }}</span>
    </div>

    <div class="header">
      <h2 class="page-title">我的亲人</h2>
      <button class="btn-add" @click="goCreate">+ 添加</button>
    </div>

    <div v-if="loading" class="empty">加载中…</div>

    <div v-else-if="personas.length === 0" class="empty metal">
      <div class="empty-icon">◈</div>
      <div class="empty-text">还没有添加亲人</div>
      <div class="empty-hint">上传一张照片和一段录音，生成数字人格</div>
      <button class="btn btn-primary" style="margin-top:18px;width:200px;" @click="goCreate">
        添加亲人
      </button>
    </div>

    <div v-else class="list">
      <div v-for="p in personas" :key="p.id" class="card metal">
        <img class="avatar" :src="absoluteUrl(p.avatarUrl)" @click="enterChat(p)" />
        <div class="info" @click="enterChat(p)">
          <div class="name">亲人 {{ indexLabel(p.id) }}</div>
          <div class="status" :class="p.status">
            <span class="status-dot"></span>
            {{ statusText(p.status) }}
          </div>
        </div>
        <div class="actions">
          <button class="icon-btn" title="编辑" @click="goEdit(p)">✎</button>
          <button class="icon-btn danger" title="删除" @click="onDelete(p)">✕</button>
        </div>
      </div>
    </div>

    <div v-if="confirmVisible" class="modal-mask">
      <div class="modal metal">
        <div class="modal-title">确认删除这位亲人？</div>
        <div class="modal-body">删除后无法恢复，确定要删除吗？</div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="confirmVisible = false">取消</button>
          <button class="btn btn-primary" @click="confirmDelete">确认删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { PersonaDto } from '@/api/persona';
import { listPersonas, deletePersona } from '@/api/persona';
import { absoluteUrl } from '@/config';
import { useAuthStore } from '@/stores/auth';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/utils/toast';

const router = useRouter();
const session = useSessionStore();
const auth = useAuthStore();

const phone = computed(() => auth.phone);
const personas = ref<PersonaDto[]>([]);
const loading = ref(true);
const confirmVisible = ref(false);
const pendingDelete = ref<PersonaDto | null>(null);

async function load() {
  loading.value = true;
  try {
    personas.value = await listPersonas();
  } catch (e) {
    toast((e as Error).message);
  } finally {
    loading.value = false;
  }
}

function statusText(s: string): string {
  switch (s) {
    case 'ready': return '已就绪';
    case 'pending':
    case 'training': return '训练中';
    case 'failed': return '创建失败';
    default: return s;
  }
}

function indexLabel(id: string): string {
  const i = personas.value.findIndex((p) => p.id === id);
  return String(personas.value.length - i).padStart(2, '0');
}

function enterChat(p: PersonaDto) {
  if (p.status !== 'ready') {
    toast(p.status === 'failed' ? '该亲人创建失败，请编辑重试' : '音色训练中，请稍候');
    return;
  }
  session.setPersona(p.id);
  router.push({ path: '/chat', query: { personaId: p.id } });
}

function goCreate() {
  router.push('/persona');
}

function goEdit(p: PersonaDto) {
  router.push(`/persona/${p.id}`);
}

function onDelete(p: PersonaDto) {
  pendingDelete.value = p;
  confirmVisible.value = true;
}

async function confirmDelete() {
  const p = pendingDelete.value;
  confirmVisible.value = false;
  if (!p) return;
  try {
    await deletePersona(p.id);
    toast('已删除');
    if (session.personaId === p.id) session.reset();
    await load();
  } catch (e) {
    toast((e as Error).message);
  }
}

onMounted(load);
</script>

<style scoped>
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
.page-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
}
.btn-add {
  height: 36px;
  padding: 0 16px;
  background: var(--primary-soft);
  color: var(--primary);
  border: 1px solid var(--border);
  border-radius: 18px;
  font-size: 14px;
  font-weight: 600;
}
.btn-add:active {
  background: rgba(217, 121, 81, 0.22);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
}
.avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--border);
  cursor: pointer;
  flex-shrink: 0;
}
.info {
  flex: 1;
  cursor: pointer;
  min-width: 0;
}
.name {
  font-size: 16px;
  font-weight: 600;
}
.status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-dim);
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-faint);
}
.status.ready .status-dot {
  background: #4caf7d;
  box-shadow: 0 0 6px #4caf7d;
}
.status.failed .status-dot {
  background: var(--danger);
}
.actions {
  display: flex;
  gap: 8px;
}
.icon-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--bg-2);
  border: 1px solid var(--border-soft);
  color: var(--text-dim);
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.icon-btn:active {
  background: var(--panel-2);
}
.icon-btn.danger {
  color: var(--danger);
  border-color: rgba(224, 85, 74, 0.3);
}

.empty {
  text-align: center;
  padding: 48px 24px;
  color: var(--text-dim);
}
.empty-icon {
  font-size: 40px;
  color: var(--primary);
  opacity: 0.6;
  margin-bottom: 12px;
}
.empty-text {
  font-size: 16px;
  color: var(--text);
  margin-bottom: 6px;
}
.empty-hint {
  font-size: 13px;
  color: var(--text-dim);
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
  text-align: center;
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
