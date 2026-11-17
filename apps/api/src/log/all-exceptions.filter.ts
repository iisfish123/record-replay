import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import { LOG_SINK, LogSink } from './log-sink';
import { getTraceId } from './trace-context';

const STATUS_CODE_FALLBACK: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  500: 'INTERNAL_SERVER_ERROR',
};

const GENERIC_MESSAGE = '服务器内部错误';

interface ErrorBody {
  code: string;
  message: string;
  traceId: string;
}

/** 全局兜底异常过滤器：客户端只拿安全结构，堆栈只进日志。 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(LOG_SINK) private readonly sink: LogSink) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { user?: { sub?: string } }>();
    const res = ctx.getResponse<Response>();
    const traceId = getTraceId();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const { code, message } = this.resolve(exception, status);
    const path = (req as any).originalUrl ?? (req as any).url ?? '';
    const rawMessage = exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;

    this.sink.emit({
      ts: new Date().toISOString(),
      level: 'error',
      kind: 'error',
      traceId,
      userId: req.user?.sub,
      method: (req as any).method,
      path,
      status,
      code,
      stack,
      msg: `${(req as any).method} ${path} ${status} ${rawMessage}`,
    });

    const body: ErrorBody = { code, message, traceId };
    res.status(status).json(body);
  }

  private resolve(exception: unknown, status: number): { code: string; message: string } {
    const fallbackCode = STATUS_CODE_FALLBACK[status] ?? 'INTERNAL_SERVER_ERROR';
    if (!(exception instanceof HttpException)) {
      return { code: fallbackCode, message: GENERIC_MESSAGE };
    }
    const payload = exception.getResponse();
    if (typeof payload === 'string') {
      return { code: fallbackCode, message: payload };
    }
    const obj = payload as Record<string, unknown>;
    const raw = obj.message;
    const message = Array.isArray(raw)
      ? raw.map((m) => String(m)).join('; ')
      : typeof raw === 'string'
        ? raw
        : fallbackCode;
    const code = typeof obj.code === 'string' ? obj.code : fallbackCode;
    return { code, message };
  }
}
