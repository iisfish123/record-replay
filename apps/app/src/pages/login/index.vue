<template>
  <div class="page">
    <div class="topbar"><span><span class="dot"></span>SYSTEM ONLINE</span><span>v1.0.0</span></div>

    <div class="brand">
      <div class="logo-mark">◈</div>
      <h1 class="title">怀念亲人</h1>
      <div class="sub">LET MEMORY ECHO</div>
    </div>

    <div class="field">
      <div class="field-label">PHONE NUMBER</div>
      <input class="input" v-model="phone" type="tel" maxlength="11" placeholder="请输入手机号" />
    </div>

    <div class="field">
      <div class="field-label">VERIFY CODE</div>
      <div class="code-row">
        <input class="input" v-model="code" type="tel" maxlength="8" placeholder="验证码" />
        <button class="btn btn-code" :disabled="counting > 0" @click="onSend">
          {{ counting > 0 ? `${counting}s` : '获取验证码' }}
        </button>
      </div>
    </div>

    <button class="btn btn-primary" :disabled="loading" @click="onLogin" style="margin-top:6px;">
      {{ loading ? '登录中…' : '登 录' }}
    </button>

    <div class="agreement">登录即代表同意 <a href="#">《用户协议》</a> 与 <a href="#">《隐私政策》</a></div>
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
  // 点击即开始 60s 倒数，不等服务器响应
  counting.value = 60;
  const btnText = '获取验证码';
  const timer = setInterval(() => {
    counting.value -= 1;
    if (counting.value <= 0) clearInterval(timer);
  }, 1000);
  try {
    await sendCode(phone.value);
    toast('验证码已发送');
  } catch (e) {
    // 发送失败也不恢复按钮，避免频繁请求
    toast((e as Error).message);
  }
  // 防止 lint 报未使用
  void btnText;
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
.brand {
  margin: 30px 4px 36px;
}
.logo-mark {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: linear-gradient(145deg, var(--primary), #b85c36);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 18px var(--primary-glow), inset 0 1px 0 rgba(255, 255, 255, 0.3);
  margin-bottom: 18px;
  font-size: 26px;
  color: #1a0e08;
}
.title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 2px;
  background: linear-gradient(180deg, #fff, #b8b8c0);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.sub {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-dim);
  letter-spacing: 4px;
  font-family: var(--mono);
}
.field {
  margin-bottom: 14px;
}
.field-label {
  font-size: 11px;
  color: var(--text-faint);
  letter-spacing: 2px;
  font-family: var(--mono);
  margin-bottom: 8px;
  text-transform: uppercase;
}
.code-row {
  display: flex;
  gap: 10px;
}
.code-row .input {
  flex: 1;
}
.btn-code {
  width: 124px;
  flex-shrink: 0;
  height: 50px;
  background: var(--bg-2);
  color: var(--primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 14px;
}
.btn-code[disabled] {
  color: var(--text-faint);
  border-color: var(--border-soft);
}
.agreement {
  margin-top: 18px;
  text-align: center;
  font-size: 11px;
  color: var(--text-faint);
}
.agreement a {
  color: var(--primary);
  text-decoration: none;
}
</style>
