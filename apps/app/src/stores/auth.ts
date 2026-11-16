import { defineStore } from 'pinia';
import { ref } from 'vue';
import { login as apiLogin } from '../api/auth';
import { setAuthToken } from '../api/request';

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string>((uni.getStorageSync('token') as string) || '');
  const userId = ref<string>((uni.getStorageSync('userId') as string) || '');

  if (token.value) setAuthToken(token.value);

  function setSession(nextToken: string, nextUserId: string): void {
    token.value = nextToken;
    userId.value = nextUserId;
    setAuthToken(nextToken);
    uni.setStorageSync('token', nextToken);
    uni.setStorageSync('userId', nextUserId);
  }

  async function login(phone: string, code: string): Promise<void> {
    const res = await apiLogin(phone, code);
    setSession(res.token, res.userId);
  }

  function logout(): void {
    token.value = '';
    userId.value = '';
    setAuthToken(null);
    uni.removeStorageSync('token');
    uni.removeStorageSync('userId');
  }

  return { token, userId, setSession, login, logout };
});
