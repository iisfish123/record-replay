export interface PollOptions<T> {
  fn: () => Promise<T>;
  isDone: (value: T) => boolean;
  isFailed?: (value: T) => boolean;
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export async function poll<T>(options: PollOptions<T>): Promise<T> {
  const intervalMs = options.intervalMs ?? 2500;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => Date.now());
  const start = now();

  for (;;) {
    const value = await options.fn();
    if (options.isDone(value)) return value;
    if (options.isFailed?.(value)) throw new Error('任务失败');
    if (now() - start >= timeoutMs) throw new Error('任务超时');
    await sleep(intervalMs);
  }
}
