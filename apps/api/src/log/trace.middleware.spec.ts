import { getTraceId, runWithTrace } from './trace-context';
import { TraceMiddleware } from './trace.middleware';

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

describe('TraceMiddleware', () => {
  function makeCtx(headers: Record<string, unknown> = {}) {
    const req: any = { headers };
    const res: any = { setHeader: jest.fn() };
    const next = jest.fn();
    return { req, res, next };
  }

  it('请求头没有 X-Trace-Id 时生成 UUID 并回写响应头', () => {
    const { req, res, next } = makeCtx();
    new TraceMiddleware().use(req, res, next);
    const set = res.setHeader.mock.calls[0];
    expect(set[0]).toBe('X-Trace-Id');
    expect(String(set[1])).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('请求头带了合法 X-Trace-Id 时沿用该值', () => {
    const { req, res, next } = makeCtx({ 'x-trace-id': 'T-from-client' });
    new TraceMiddleware().use(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('X-Trace-Id', 'T-from-client');
  });

  it('请求头 X-Trace-Id 超过 64 字符时视为脏数据，重新生成', () => {
    const { req, res, next } = makeCtx({ 'x-trace-id': 'x'.repeat(65) });
    new TraceMiddleware().use(req, res, next);
    expect(res.setHeader.mock.calls[0][1]).not.toBe('x'.repeat(65));
    expect(res.setHeader.mock.calls[0][1]).toMatch(/[0-9a-f-]{36}/);
  });

  it('请求头 X-Trace-Id 为空字符串时重新生成', () => {
    const { req, res, next } = makeCtx({ 'x-trace-id': '' });
    new TraceMiddleware().use(req, res, next);
    expect(res.setHeader.mock.calls[0][1]).toMatch(/[0-9a-f-]{36}/);
  });

  it('下游 next 内 getTraceId() 与响应头一致', () => {
    const { req, res, next } = makeCtx();
    let seen = '';
    next.mockImplementation(() => {
      seen = getTraceId();
    });
    new TraceMiddleware().use(req, res, next);
    expect(seen).toBe(res.setHeader.mock.calls[0][1]);
    expect(seen).toHaveLength(36);
  });

  it('中间件执行完（请求结束后）不残留上下文', () => {
    const { req, res, next } = makeCtx();
    new TraceMiddleware().use(req, res, next);
    expect(getTraceId()).toBe('-');
  });
});
