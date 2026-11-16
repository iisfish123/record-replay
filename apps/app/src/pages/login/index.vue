<template>
  <div class="page">
    <div class="brand">
      <div class="title">怀念亲人</div>
      <div class="subtitle">让思念，有回声</div>
    </div>

    <input
      class="input"
      v-model="phone"
      type="tel"
      maxlength="11"
      placeholder="请输入手机号"
    />

    <div class="row">
      <input
        class="input code"
        v-model="code"
        type="tel"
        maxlength="8"
        placeholder="验证码"
      />
      <button class="btn-send" :disabled="counting > 0" @click="onSend">
        {{ counting > 0 ? `${counting}s` : '获取验证码' }}
      </button>
    </div>

    <button class="btn-primary" :disabled="loading" @click="onLogin">
      {{ loading ? '登录中…' : '登录' }}
    </button>

    <div class="agreement">登录即代表同意《用户协议》与《隐私政策》</div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { PhoneSchema, CodeSchema } from '@record-replay/shared';
import { sendCode } from '@/api/auth';
import { useAuthStore } from '@/stores/auth';
import { toast } from '@/utils/toast';

const router = useRouter();
const auth = useAuthStore();

const phone = ref('');
const code = ref('');
const counting = ref(0);
const loading = ref(false);

async function onSend() {
  if (!PhoneSchema.safeParse(phone.value).success) return toast('请输入正确的手机号');
  try {
    await sendCode(phone.value);
    toast('验证码已发送');
    counting.value = 60;
    const timer = setInterval(() => {
      counting.value -= 1;
      if (counting.value <= 0) clearInterval(timer);
    }, 1000);
  } catch (e) {
    toast((e as Error).message);
  }
}

async function onLogin() {
  if (!PhoneSchema.safeParse(phone.value).success) return toast('请输入正确的手机号');
  if (!CodeSchema.safeParse(code.value).success) return toast('请输入正确的验证码');
  loading.value = true;
  try {
    await auth.login(phone.value, code.value);
    router.replace('/home');
  } catch (e) {
    toast((e as Error).message);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.page {
  padding: 60px 24px 0;
}
.brand {
  margin-bottom: 40px;
}
.title {
  font-size: 26px;
  font-weight: 700;
  color: #1a1a1a;
}
.subtitle {
  margin-top: 8px;
  font-size: 14px;
  color: #8a8a94;
}
.input {
  width: 100%;
  height: 48px;
  padding: 0 14px;
  background: #ffffff;
  border-radius: 10px;
  font-size: 15px;
  margin-bottom: 12px;
}
.input::placeholder {
  color: #b6b6bf;
}
.row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.code {
  flex: 1;
  margin-bottom: 0;
}
.btn-send {
  width: 120px;
  height: 48px;
  font-size: 14px;
  color: #2b6cff;
  background: #eaf1ff;
  border-radius: 10px;
}
.btn-send[disabled] {
  color: #9d9da8;
  background: #efeff3;
}
.btn-primary {
  margin-top: 24px;
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
.agreement {
  margin-top: 20px;
  text-align: center;
  font-size: 12px;
  color: #a8a8b2;
}
</style>
