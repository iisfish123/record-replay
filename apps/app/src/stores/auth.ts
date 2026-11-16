import { defineStore } from 'pinia';
import { ref } from 'vue';
import { login as apiLogin } from '../api/auth';
import { setAuthToken } from '../api/request';

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string>(localStorage.getItem('token') || '');
  const userId = ref<string>(localStorage.getItem('userId') || '');

  if (token.value) setAuthToken(token.value);

  function setSession(nextToken: string, nextUserId: string): void {
    token.value = nextToken;
    userId.value = nextUserId;
    setAuthToken(nextToken);
    localStorage.setItem('token', nextToken);
    localStorage.setItem('userId', nextUserId);
  }

  async function login(phone: string, code: string): Promise<void> {
    const res = await apiLogin(phone, code);
    setSession(res.token, res.userId);
  }

  function logout(): void {
    token.value = '';
    userId.value = '';
    setAuthToken(null);
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
  }

  return { token, userId, setSession, login, logout };
});
