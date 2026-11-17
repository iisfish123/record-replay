import { getTraceId, runWithTrace } from './trace-context';

describe('trace-context', () => {
  it('不在任何上下文里时 getTraceId 返回 "-"', () => {
    expect(getTraceId()).toBe('-');
  });

  it('runWithTrace 内 getTraceId 返回传入的 traceId', () => {
    const seen = runWithTrace('T-abc', () => getTraceId());
    expect(seen).toBe('T-abc');
  });

  it('runWithTrace 结束后上下文恢复为空', () => {
    runWithTrace('T-abc', () => undefined);
    expect(getTraceId()).toBe('-');
  });

  it('嵌套 runWithTrace 时以内层为准，退出后回到外层', () => {
    const result = runWithTrace('outer', () => {
      const inner = runWithTrace('inner', () => getTraceId());
      return { inner, after: getTraceId() };
    });
    expect(result).toEqual({ inner: 'inner', after: 'outer' });
  });

  it('await 之后仍能拿到同一个 traceId', async () => {
    await runWithTrace('T-await', async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(getTraceId()).toBe('T-await');
    });
  });
});
