import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { LOG_SINK, LogSink } from './log-sink';
import { getTraceId } from './trace-context';

/** 每个 HTTP 请求在响应结束后发一条 kind:'access' 日志。 */
@Injectable()
export class AccessLogInterceptor implements NestInterceptor {
  constructor(@Inject(LOG_SINK) private readonly sink: LogSink) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<any>();
    const res = http.getResponse<any>();
    const startedAt = Date.now();
    const path = req.originalUrl ?? req.url;

    const emit = (status: number): void => {
      const durationMs = Date.now() - startedAt;
      this.sink.emit({
        ts: new Date().toISOString(),
        level: 'info',
        kind: 'access',
        traceId: getTraceId(),
        userId: req.user?.sub,
        method: req.method,
        path,
        status,
        durationMs,
        msg: `${req.method} ${path} ${status} ${durationMs}ms`,
      });
    };

    return next.handle().pipe(
      tap(() => emit(res.statusCode)),
      catchError((err: any) => {
        emit(typeof err?.getStatus === 'function' ? err.getStatus() : 500);
        return throwError(() => err);
      }),
    );
  }
}
