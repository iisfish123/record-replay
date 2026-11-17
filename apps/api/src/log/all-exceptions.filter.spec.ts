import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { InMemoryLogSink } from './in-memory-log-sink';
import { runWithTrace } from './trace-context';

function makeHost() {
  const req: any = { method: 'GET', originalUrl: '/tasks/nope', user: { sub: 'u-1' } };
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return { host: { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) } as any, res };
}

describe('AllExceptionsFilter', () => {
  it('HttpException：保持原 status，返回统一 { code, message, traceId }', () => {
    const sink = new InMemoryLogSink();
    const { host, res } = makeHost();

    runWithTrace('T-404', () => new AllExceptionsFilter(sink).catch(new NotFoundException('任务不存在'), host));

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ code: 'NOT_FOUND', message: '任务不存在', traceId: 'T-404' });
  });

  it('HttpException 自带 code 时优先使用它', () => {
    const sink = new InMemoryLogSink();
    const { host, res } = makeHost();
    const ex = new HttpException({ code: 'TASK_NOT_FOUND', message: '任务不存在' }, 404);

    runWithTrace('T-code', () => new AllExceptionsFilter(sink).catch(ex, host));

    expect(res.json).toHaveBeenCalledWith({ code: 'TASK_NOT_FOUND', message: '任务不存在', traceId: 'T-code' });
  });

  it('数组 message（class-validator 风格）拼成一句', () => {
    const sink = new InMemoryLogSink();
    const { host, res } = makeHost();
    const ex = new BadRequestException({ message: ['问题不能为空', '长度超限'] });

    runWithTrace('T-arr', () => new AllExceptionsFilter(sink).catch(ex, host));

    expect((res.json.mock.calls[0][0] as any).message).toBe('问题不能为空; 长度超限');
  });

  it('未知 Error：status=500，message 用通用文案，不泄漏原始信息', () => {
    const sink = new InMemoryLogSink();
    const { host, res } = makeHost();

    runWithTrace('T-500', () => new AllExceptionsFilter(sink).catch(new Error('SQL: select * from users'), host));

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      code: 'INTERNAL_SERVER_ERROR',
      message: '服务器内部错误',
      traceId: 'T-500',
    });
  });

  it('响应体里不含 stack，但日志里含 stack', () => {
    const sink = new InMemoryLogSink();
    const { host, res } = makeHost();

    runWithTrace('T-stack', () => new AllExceptionsFilter(sink).catch(new Error('boom'), host));

    const body = res.json.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('stack');
    const logged = sink.findByKind('error');
    expect(logged).toHaveLength(1);
    expect(logged[0].stack).toContain('boom');
  });

  it('错误日志字段完整：kind/level/status/code/method/path/userId/traceId', () => {
    const sink = new InMemoryLogSink();
    const { host } = makeHost();

    runWithTrace('T-fields', () => new AllExceptionsFilter(sink).catch(new NotFoundException('任务不存在'), host));

    expect(sink.findByKind('error')[0]).toMatchObject({
      level: 'error',
      kind: 'error',
      traceId: 'T-fields',
      userId: 'u-1',
      method: 'GET',
      path: '/tasks/nope',
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('非 Error 抛出物（字符串）也不崩，回 500', () => {
    const sink = new InMemoryLogSink();
    const { host, res } = makeHost();

    runWithTrace('T-str', () => new AllExceptionsFilter(sink).catch('炸了', host));

    expect(res.status).toHaveBeenCalledWith(500);
    expect((res.json.mock.calls[0][0] as any).message).toBe('服务器内部错误');
  });
});
