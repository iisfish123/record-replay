import { describe, it, expect, vi } from 'vitest';
import { poll } from '../src/utils/poll';

const noSleep = () => Promise.resolve();

describe('poll', () => {
  it('第一次就满足 done 时立即返回，不再等待', async () => {
    const fn = vi.fn().mockResolvedValue({ status: 'ready' });
    const result = await poll({
      fn,
      isDone: (v) => v.status === 'ready',
      sleep: noSleep,
    });
    expect(result).toEqual({ status: 'ready' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('多次轮询后满足 done', async () => {
    const seq = [{ status: 'pending' }, { status: 'training' }, { status: 'ready' }];
    let i = 0;
    const fn = vi.fn(() => Promise.resolve(seq[i++]));
    const result = await poll({
      fn,
      isDone: (v) => v.status === 'ready',
      sleep: noSleep,
    });
    expect(result.status).toBe('ready');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('命中 failed 时抛错', async () => {
    const fn = vi.fn().mockResolvedValue({ status: 'failed' });
    await expect(
      poll({ fn, isDone: () => false, isFailed: (v) => v.status === 'failed', sleep: noSleep }),
    ).rejects.toThrow('任务失败');
  });

  it('超时抛错', async () => {
    const fn = vi.fn().mockResolvedValue({ status: 'pending' });
    let t = 0;
    await expect(
      poll({
        fn,
        isDone: () => false,
        timeoutMs: 1000,
        sleep: async () => {
          t += 600;
        },
        now: () => t,
      }),
    ).rejects.toThrow('任务超时');
  });

  it('每次轮询之间调用 sleep', async () => {
    const sleep = vi.fn(noSleep);
    const seq = [{ status: 'pending' }, { status: 'ready' }];
    let i = 0;
    await poll({ fn: () => Promise.resolve(seq[i++]), isDone: (v) => v.status === 'ready', sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
