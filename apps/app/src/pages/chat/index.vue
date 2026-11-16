<template>
  <view class="page">
    <view class="stage">
      <video
        v-if="videoUrl"
        class="video"
        :src="videoUrl"
        :poster="poster"
        controls
        autoplay
        object-fit="cover"
      />
      <view v-else class="placeholder">
        <image v-if="poster" class="poster" :src="poster" mode="aspectFill" />
        <view class="phase">{{ phaseText }}</view>
      </view>
    </view>

    <view v-if="answerText" class="bubble">
      <text class="quote">“{{ answerText }}”</text>
    </view>

    <view class="input-row">
      <input
        class="input"
        v-model="question"
        placeholder="对他说点什么…"
        placeholder-class="ph"
        :disabled="asking"
        confirm-type="send"
        @confirm="onAsk"
      />
      <button class="btn-send" :loading="asking" :disabled="asking" @click="onAsk">发送</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { AskSchema } from '@record-replay/shared';
import { ask, getTask } from '@/api/task';
import { getPersona } from '@/api/persona';
import { absoluteUrl } from '@/config';
import { poll } from '@/utils/poll';
import { useSessionStore } from '@/stores/session';

const session = useSessionStore();

const personaId = ref('');
const poster = ref('');
const question = ref('');
const answerText = ref('');
const videoUrl = ref('');
const asking = ref(false);
const phaseText = ref('输入一句话，让他/她来回答你');

onLoad(async (query) => {
  personaId.value = (query?.personaId as string) || session.personaId;
  if (!personaId.value) {
    uni.showToast({ title: '未找到人格档案', icon: 'none' });
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
    uni.showToast({ title: '请输入 1–200 字的问题', icon: 'none' });
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
    uni.showToast({ title: (e as Error).message, icon: 'none' });
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
  padding: 32rpx;
  box-sizing: border-box;
}
.stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #101014;
  border-radius: 24rpx;
  overflow: hidden;
  min-height: 760rpx;
}
.video {
  width: 100%;
  height: 900rpx;
}
.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.poster {
  width: 320rpx;
  height: 320rpx;
  border-radius: 50%;
  opacity: 0.55;
}
.phase {
  margin-top: 32rpx;
  color: #cfcfd8;
  font-size: 28rpx;
}
.bubble {
  margin-top: 28rpx;
  background: #ffffff;
  border-radius: 20rpx;
  padding: 28rpx 32rpx;
}
.quote {
  font-size: 30rpx;
  color: #2a2a33;
  line-height: 1.6;
}
.input-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-top: 24rpx;
  padding-bottom: env(safe-area-inset-bottom);
}
.input {
  flex: 1;
  height: 92rpx;
  padding: 0 28rpx;
  background: #ffffff;
  border-radius: 20rpx;
  font-size: 30rpx;
}
.ph {
  color: #b6b6bf;
}
.btn-send {
  width: 180rpx;
  height: 92rpx;
  line-height: 92rpx;
  font-size: 30rpx;
  color: #ffffff;
  background: #2b6cff;
  border-radius: 20rpx;
  margin: 0;
}
</style>
