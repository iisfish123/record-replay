import { AsyncLocalStorage } from 'node:async_hooks';

export interface TraceContext {
  traceId: string;
}

/**
 * 用 AsyncLocalStorage 承载 traceId：只要在 run() 的调用链里，
 * 任意深度的同步/异步函数都能 getTraceId()，不用层层传参。
 */
export const traceStorage = new AsyncLocalStorage<TraceContext>();

export function getTraceId(): string {
  return traceStorage.getStore()?.traceId ?? '-';
}

export function runWithTrace<T>(traceId: string, fn: () => T): T {
  return traceStorage.run({ traceId }, fn);
}
