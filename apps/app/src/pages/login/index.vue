<template>
  <view class="page">
    <view class="brand">
      <view class="title">怀念亲人</view>
      <view class="subtitle">让思念，有回声</view>
    </view>

    <input
      class="input"
      v-model="phone"
      type="number"
      maxlength="11"
      placeholder="请输入手机号"
      placeholder-class="ph"
    />

    <view class="row">
      <input
        class="input code"
        v-model="code"
        type="number"
        maxlength="8"
        placeholder="验证码"
        placeholder-class="ph"
      />
      <button class="btn-send" :disabled="counting > 0" @click="onSend">
        {{ counting > 0 ? `${counting}s` : '获取验证码' }}
      </button>
    </view>

    <button class="btn-primary" :loading="loading" :disabled="loading" @click="onLogin">登录</button>

    <view class="agreement">登录即代表同意《用户协议》与《隐私政策》</view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { PhoneSchema, CodeSchema } from '@record-replay/shared';
import { sendCode } from '@/api/auth';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();

const phone = ref('');
const code = ref('');
const counting = ref(0);
const loading = ref(false);

function toast(title: string) {
  uni.showToast({ title, icon: 'none' });
}

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
    uni.reLaunch({ url: '/pages/home/index' });
  } catch (e) {
    toast((e as Error).message);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.page {
  padding: 120rpx 48rpx 0;
}
.brand {
  margin-bottom: 80rpx;
}
.title {
  font-size: 52rpx;
  font-weight: 700;
  color: #1a1a1a;
}
.subtitle {
  margin-top: 16rpx;
  font-size: 28rpx;
  color: #8a8a94;
}
.input {
  height: 96rpx;
  padding: 0 28rpx;
  background: #ffffff;
  border-radius: 20rpx;
  font-size: 30rpx;
  margin-bottom: 24rpx;
}
.ph {
  color: #b6b6bf;
}
.row {
  display: flex;
  align-items: flex-start;
  gap: 20rpx;
}
.code {
  flex: 1;
  margin-bottom: 0;
}
.btn-send {
  width: 240rpx;
  height: 96rpx;
  line-height: 96rpx;
  font-size: 28rpx;
  color: #2b6cff;
  background: #eaf1ff;
  border-radius: 20rpx;
  margin: 0;
}
.btn-send[disabled] {
  color: #9d9da8;
  background: #efeff3;
}
.btn-primary {
  margin-top: 48rpx;
  height: 96rpx;
  line-height: 96rpx;
  font-size: 32rpx;
  color: #ffffff;
  background: #2b6cff;
  border-radius: 20rpx;
}
.agreement {
  margin-top: 40rpx;
  text-align: center;
  font-size: 24rpx;
  color: #a8a8b2;
}
</style>
