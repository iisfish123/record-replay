import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('../src/api/auth', () => ({ sendCode: vi.fn(), login: vi.fn() }));
import { login as apiLogin } from '../src/api/auth';
import { useAuthStore } from '../src/stores/auth';
import { useSessionStore } from '../src/stores/session';

const mockedLogin = apiLogin as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  setActivePinia(createPinia());
  uni.removeStorageSync('token');
  uni.removeStorageSync('userId');
  uni.removeStorageSync('personaId');
  mockedLogin.mockReset();
});

describe('auth store', () => {
  it('初始 token 为空', () => {
    const store = useAuthStore();
    expect(store.token).toBe('');
  });

  it('login 成功后写入 token/userId 并持久化', async () => {
    mockedLogin.mockResolvedValue({ token: 'jwt-1', userId: 'u-1' });
    const store = useAuthStore();
    await store.login('15920328477', '123456');
    expect(store.token).toBe('jwt-1');
    expect(store.userId).toBe('u-1');
    expect(uni.getStorageSync('token')).toBe('jwt-1');
    expect(uni.getStorageSync('userId')).toBe('u-1');
  });

  it('setSession 会同步 token 到 request 层', async () => {
    const store = useAuthStore();
    store.setSession('jwt-2', 'u-2');
    const { getAuthToken } = await import('../src/api/request');
    expect(getAuthToken()).toBe('jwt-2');
  });

  it('logout 清空 token 与 storage', () => {
    const store = useAuthStore();
    store.setSession('jwt-3', 'u-3');
    store.logout();
    expect(store.token).toBe('');
    expect(uni.getStorageSync('token')).toBe('');
  });

  it('从 storage 恢复 token', () => {
    uni.setStorageSync('token', 'restored');
    uni.setStorageSync('userId', 'u-9');
    const store = useAuthStore();
    expect(store.token).toBe('restored');
    expect(store.userId).toBe('u-9');
  });
});

describe('session store', () => {
  it('初始 personaId 为空', () => {
    const store = useSessionStore();
    expect(store.personaId).toBe('');
  });

  it('setPersona 写入并持久化', () => {
    const store = useSessionStore();
    store.setPersona('p-1');
    expect(store.personaId).toBe('p-1');
    expect(uni.getStorageSync('personaId')).toBe('p-1');
  });

  it('setTask 记录 taskId（不持久化）', () => {
    const store = useSessionStore();
    store.setTask('t-1');
    expect(store.taskId).toBe('t-1');
    expect(uni.getStorageSync('taskId')).toBe('');
  });

  it('reset 清空并删除持久化', () => {
    const store = useSessionStore();
    store.setPersona('p-1');
    store.setTask('t-1');
    store.reset();
    expect(store.personaId).toBe('');
    expect(store.taskId).toBe('');
    expect(uni.getStorageSync('personaId')).toBe('');
  });

  it('从 storage 恢复 personaId', () => {
    uni.setStorageSync('personaId', 'p-restored');
    const store = useSessionStore();
    expect(store.personaId).toBe('p-restored');
    uni.removeStorageSync('personaId');
  });
});
