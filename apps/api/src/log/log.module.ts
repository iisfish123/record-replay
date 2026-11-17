import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessLogInterceptor } from './access-log.interceptor';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppLoggerService } from './app-logger.service';
import { KafkaLogSink } from './kafka-log-sink';
import { LOG_SINK, LogSink } from './log-sink';
import { NoopLogSink } from './noop-log-sink';
import { TaskTracer } from './task-tracer';
import { TraceMiddleware } from './trace.middleware';

/** 日志基础设施：一次性把 Sink 与三个消费者（拦截器/过滤器/埋点）注册成全局 Provider。 */
@Global()
@Module({
  providers: [
    {
      provide: LOG_SINK,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): LogSink => {
        if (!cfg.get<boolean>('log.kafkaEnabled')) {
          Logger.warn('LOG_KAFKA_ENABLED=false，日志不发送到 Kafka', 'LogModule');
          return new NoopLogSink();
        }
        return new KafkaLogSink({
          brokers: cfg.get<string>('log.kafkaBrokers')!.split(','),
          clientId: cfg.get<string>('log.kafkaClientId')!,
          flushIntervalMs: cfg.get<number>('log.flushIntervalMs')!,
          batchMax: cfg.get<number>('log.batchMax')!,
          queueMax: cfg.get<number>('log.queueMax')!,
        });
      },
    },
    TraceMiddleware,
    AccessLogInterceptor,
    AllExceptionsFilter,
    TaskTracer,
    AppLoggerService,
  ],
  exports: [LOG_SINK, TraceMiddleware, AccessLogInterceptor, AllExceptionsFilter, TaskTracer, AppLoggerService],
})
export class LogModule {}
