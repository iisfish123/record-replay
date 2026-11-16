<template>
  <div class="page">
    <div class="stage">
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
      <div v-else class="placeholder">
        <img v-if="poster" class="poster" :src="poster" />
        <div class="phase">{{ phaseText }}</div>
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
        :disabled="asking"
        @keydown.enter="onAsk"
      />
      <button class="btn-send" :disabled="asking" @click="onAsk">发送</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { AskSchema } from '@record-replay/shared';
import { ask, getTask } from '@/api/task';
import { getPersona } from '@/api/persona';
import { absoluteUrl } from '@/config';
import { poll } from '@/utils/poll';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/utils/toast';

const route = useRoute();
const session = useSessionStore();

const personaId = ref('');
const poster = ref('');
const question = ref('');
const answerText = ref('');
const videoUrl = ref('');
const asking = ref(false);
const phaseText = ref('输入一句话，让他/她来回答你');

onMounted(async () => {
  personaId.value = (route.query.personaId as string) || session.personaId;
  if (!personaId.value) {
    toast('未找到人格档案');
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
  asking.value = true;
  answerText.value = '';
  videoUrl.value = '';
  phaseText.value = '正在思考…';
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
    asking.value = false;
  }
}
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding: 16px;
  box-sizing: border-box;
}
.stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #101014;
  border-radius: 12px;
  overflow: hidden;
  min-height: 380px;
}
.video {
  width: 100%;
  height: 450px;
  object-fit: contain;
}
.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.poster {
  width: 160px;
  height: 160px;
  border-radius: 50%;
  opacity: 0.55;
  object-fit: cover;
}
.phase {
  margin-top: 16px;
  color: #cfcfd8;
  font-size: 14px;
}
.bubble {
  margin-top: 14px;
  background: #ffffff;
  border-radius: 10px;
  padding: 14px 16px;
}
.quote {
  font-size: 15px;
  color: #2a2a33;
  line-height: 1.6;
}
.input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding-bottom: env(safe-area-inset-bottom);
}
.input {
  flex: 1;
  height: 46px;
  padding: 0 14px;
  background: #ffffff;
  border-radius: 10px;
  font-size: 15px;
}
.input::placeholder {
  color: #b6b6bf;
}
.btn-send {
  width: 90px;
  height: 46px;
  font-size: 15px;
  color: #ffffff;
  background: #2b6cff;
  border-radius: 10px;
}
.btn-send[disabled] {
  opacity: 0.6;
}
</style>
