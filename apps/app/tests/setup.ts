import { vi } from 'vitest';

const storage = new Map<string, unknown>();

vi.stubGlobal('uni', {
  request: vi.fn(),
  uploadFile: vi.fn(),
  getStorageSync: (k: string) => storage.get(k) ?? '',
  setStorageSync: (k: string, v: unknown) => {
    storage.set(k, v);
  },
  removeStorageSync: (k: string) => {
    storage.delete(k);
  },
  showToast: vi.fn(),
  chooseImage: vi.fn(),
  getRecorderManager: vi.fn(),
  navigateTo: vi.fn(),
  reLaunch: vi.fn(),
});

export {};
