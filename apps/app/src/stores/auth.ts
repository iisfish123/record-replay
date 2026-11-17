import { defineStore } from 'pinia';
import { ref } from 'vue';
import { login as apiLogin } from '../api/auth';
import { setAuthToken } from '../api/request';

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string>(localStorage.getItem('token') || '');
  const userId = ref<string>(localStorage.getItem('userId') || '');
  const phone = ref<string>(localStorage.getItem('phone') || '');

  if (token.value) setAuthToken(token.value);

  function setSession(nextToken: string, nextUserId: string, nextPhone?: string): void {
    token.value = nextToken;
    userId.value = nextUserId;
    if (nextPhone) {
      phone.value = nextPhone;
      localStorage.setItem('phone', nextPhone);
    }
    setAuthToken(nextToken);
    localStorage.setItem('token', nextToken);
    localStorage.setItem('userId', nextUserId);
  }

  async function login(loginPhone: string, code: string): Promise<void> {
    const res = await apiLogin(loginPhone, code);
    setSession(res.token, res.userId, loginPhone);
  }

  function logout(): void {
    token.value = '';
    userId.value = '';
    phone.value = '';
    setAuthToken(null);
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('phone');
  }

  return { token, userId, phone, setSession, login, logout };
});
