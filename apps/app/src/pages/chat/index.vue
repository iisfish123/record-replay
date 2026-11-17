<template>
  <div class="page chat-page">
    <div class="topbar">
      <span><span class="dot"></span>DIALOGUE</span>
      <span @click="goHome" class="back">← 亲人</span>
    </div>

    <div class="stage" id="stage">
      <video
        v-if="videoUrl"
        class="video"
        :src="videoUrl"
        :poster="poster"
        controls
        autoplay
        playsinline
        webkit-playsinline
      />
      <div v-else class="stage-placeholder">
        <div class="poster-ring">
          <img v-if="poster" :src="poster" alt="" />
        </div>
        <div class="phase" v-if="phaseText">{{ phaseText }}</div>
      </div>
    </div>

    <div v-if="answerText" class="bubble">
      <span class="quote">"{{ answerText }}"</span>
    </div>

    <div class="input-row">
      <input
        class="input"
        v-model="question"
        placeholder="对他说点什么…"
        :disabled="cooldown > 0"
        @keydown.enter="onAsk"
      />
      <button class="btn btn-send" :class="{ counting: cooldown > 0 }" :disabled="cooldown > 0" @click="onAsk">
        {{ cooldown > 0 ? `${cooldown}s` : '发送' }}
      </button>
    </div>
    <div class="progress" v-if="progressVisible">
      <div class="progress-bar" :style="{ width: progress + '%' }"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { AskSchema } from '@record-replay/shared';
import { ask, getTask } from '@/api/task';
import { getPersona } from '@/api/persona';
import { absoluteUrl } from '@/config';
import { poll } from '@/utils/poll';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/utils/toast';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const personaId = ref('');
const poster = ref('');
const question = ref('');
const answerText = ref('');
const videoUrl = ref('');
const phaseText = ref('输入一句话，让他/她来回答你');
const cooldown = ref(0); // 60 秒倒数
const progress = ref(0);
const progressVisible = ref(false);

let cooldownTimer: ReturnType<typeof setInterval> | null = null;

function startCooldown() {
  cooldown.value = 60;
  if (cooldownTimer) clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    cooldown.value -= 1;
    if (cooldown.value <= 0) {
      clearInterval(cooldownTimer!);
      cooldownTimer = null;
    }
  }, 1000);
}

function goHome() {
  router.replace('/home');
}

onMounted(async () => {
  personaId.value = (route.query.personaId as string) || session.personaId;
  if (!personaId.value) {
    toast('未找到人格档案');
    router.replace('/home');
    return;
  }
  try {
    const persona = await getPersona(personaId.value);
    poster.value = absoluteUrl(persona.avatarUrl);
  } catch {
    /* 头像加载失败不阻塞主流程 */
  }
});

async function onAsk() {
  const q = question.value.trim();
  if (!AskSchema.safeParse({ question: q }).success) {
    toast('请输入 1–200 字的问题');
    return;
  }

  // 点击发送立即禁用按钮 + 60 秒倒数，不等服务器响应
  startCooldown();
  answerText.value = '';
  videoUrl.value = '';
  phaseText.value = '正在思考…';
  progressVisible.value = true;
  progress.value = 0;

  let progTimer: ReturnType<typeof setInterval> | null = null;
  progTimer = setInterval(() => {
    progress.value = Math.min(100, progress.value + Math.random() * 8);
  }, 400);

  try {
    const { taskId } = await ask(personaId.value, q);
    session.setTask(taskId);

    const task = await poll({
      fn: () => getTask(taskId),
      isDone: (t) => t.status === 'done',
      isFailed: (t) => t.status === 'failed',
      intervalMs: 3000,
      timeoutMs: 300_000,
    });

    answerText.value = task.answerText ?? '';
    videoUrl.value = absoluteUrl(task.videoUrl ?? '');
    phaseText.value = '';
    question.value = '';
  } catch (e) {
    phaseText.value = (e as Error).message;
    toast((e as Error).message);
  } finally {
    if (progTimer) clearInterval(progTimer);
    progress.value = 100;
    setTimeout(() => {
      progressVisible.value = false;
    }, 600);
  }
}
</script>

<style scoped>
.chat-page {
  padding: 12px 16px 16px;
}
.back {
  cursor: pointer;
  color: var(--primary);
}
.stage {
  flex: 1;
  border-radius: var(--radius);
  overflow: hidden;
  position: relative;
  background: #000;
  border: 1px solid var(--border-soft);
  min-height: 360px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.stage video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
/* 扫描线装饰 */
.stage::after {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent 0,
    transparent 2px,
    rgba(217, 121, 81, 0.03) 3px,
    transparent 4px
  );
  pointer-events: none;
}
.stage-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.poster-ring {
  width: 150px;
  height: 150px;
  border-radius: 50%;
  border: 2px solid var(--border);
  padding: 4px;
  box-shadow: 0 0 30px var(--primary-glow), inset 0 0 20px rgba(0, 0, 0, 0.5);
}
.poster-ring img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  opacity: 0.7;
}
.phase {
  color: var(--text-dim);
  font-size: 13px;
  font-family: var(--mono);
  letter-spacing: 1px;
}
.phase::before {
  content: '▸ ';
  color: var(--primary);
}
.bubble {
  margin-top: 12px;
  background: linear-gradient(180deg, var(--panel-1), var(--panel-2));
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  padding: 14px 16px;
  position: relative;
}
.bubble::before {
  content: '';
  position: absolute;
  top: -6px;
  left: 24px;
  width: 12px;
  height: 12px;
  background: var(--panel-1);
  border-left: 1px solid var(--border-soft);
  border-top: 1px solid var(--border-soft);
  transform: rotate(45deg);
}
.quote {
  font-size: 15px;
  color: var(--text);
  line-height: 1.6;
}
.input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.input-row .input {
  flex: 1;
}
.btn-send {
  width: 96px;
  height: 50px;
  flex-shrink: 0;
  color: #1a0e08;
  background: linear-gradient(180deg, #e8906a, var(--primary));
  box-shadow: 0 6px 16px var(--primary-glow), inset 0 1px 0 rgba(255, 255, 255, 0.35);
  font-weight: 600;
  border-radius: var(--radius-sm);
}
.btn-send[disabled] {
  opacity: 0.5;
  box-shadow: none;
}
.btn-send.counting {
  font-family: var(--mono);
  font-size: 14px;
}
.progress {
  height: 3px;
  background: var(--bg-2);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 10px;
}
.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--primary), #e8906a);
  box-shadow: 0 0 8px var(--primary-glow);
  transition: width 0.3s;
}
</style>
