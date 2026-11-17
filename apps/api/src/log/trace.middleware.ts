import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { traceStorage } from './trace-context';

const MAX_TRACE_ID_LEN = 64;

/** 沿用合法请求头，否则生成新的；校验长度防止日志注入超长/跨行串。 */
function normalizeTraceId(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length >= 1 && trimmed.length <= MAX_TRACE_ID_LEN) return trimmed;
  }
  return randomUUID();
}

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const traceId = normalizeTraceId(req.headers['x-trace-id']);
    res.setHeader('X-Trace-Id', traceId);
    traceStorage.run({ traceId }, () => next());
  }
}
