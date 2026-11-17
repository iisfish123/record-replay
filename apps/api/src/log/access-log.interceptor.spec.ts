import { BadRequestException } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { AccessLogInterceptor } from './access-log.interceptor';
import { InMemoryLogSink } from './in-memory-log-sink';
import { runWithTrace } from './trace-context';

function makeContext(opts: { user?: any; statusCode?: number } = {}) {
  const req: any = { method: 'POST', originalUrl: '/personas/p1/ask', user: opts.user };
  const res: any = { statusCode: opts.statusCode ?? 201 };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as any;
}

describe('AccessLogInterceptor', () => {
  it('成功请求后发出一条 access 日志，含 method/path/status/duration/traceId', async () => {
    const sink = new InMemoryLogSink();
    const interceptor = new AccessLogInterceptor(sink);

    await runWithTrace('T-1', () =>
      firstValueFrom(interceptor.intercept(makeContext(), { handle: () => of({ ok: true }) })),
    );

    const records = sink.findByKind('access');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 'info',
      traceId: 'T-1',
      method: 'POST',
      path: '/personas/p1/ask',
      status: 201,
    });
    expect(records[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(records[0].msg).toMatch(/^POST \/personas\/p1\/ask 201 \d+ms$/);
  });

  it('handler 抛 400 时仍记一条 access，status=400，并把异常继续抛出', async () => {
    const sink = new InMemoryLogSink();
    const interceptor = new AccessLogInterceptor(sink);

    await expect(
      runWithTrace('T-2', () =>
        firstValueFrom(
          interceptor.intercept(makeContext(), { handle: () => throwError(() => new BadRequestException('参数错误')) }),
        ),
      ),
    ).rejects.toThrow('参数错误');

    expect(sink.findByKind('access')[0]).toMatchObject({ traceId: 'T-2', status: 400 });
  });

  it('非 HttpException 抛错时 status 记为 500', async () => {
    const sink = new InMemoryLogSink();
    const interceptor = new AccessLogInterceptor(sink);

    await expect(
      runWithTrace('T-3', () =>
        firstValueFrom(interceptor.intercept(makeContext(), { handle: () => throwError(() => new Error('boom')) })),
      ),
    ).rejects.toThrow('boom');

    expect(sink.findByKind('access')[0]).toMatchObject({ traceId: 'T-3', status: 500 });
  });

  it('req.user 存在时带上 userId，匿名请求则不带', async () => {
    const sink = new InMemoryLogSink();
    const interceptor = new AccessLogInterceptor(sink);

    await runWithTrace('T-4', () =>
      firstValueFrom(interceptor.intercept(makeContext({ user: { sub: 'u-9' } }), { handle: () => of(null) })),
    );
    expect(sink.findByKind('access')[0].userId).toBe('u-9');

    sink.clear();
    await runWithTrace('T-5', () =>
      firstValueFrom(interceptor.intercept(makeContext(), { handle: () => of(null) })),
    );
    expect(sink.findByKind('access')[0].userId).toBeUndefined();
  });
});
