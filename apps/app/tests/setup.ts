import { vi } from 'vitest';

// jsdom 已提供 localStorage、FormData、URL.createObjectURL

// mock fetch，由各 spec 自行设置实现
vi.stubGlobal(
  'fetch',
  vi.fn().mockResolvedValue(
    new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ),
);

export {};
