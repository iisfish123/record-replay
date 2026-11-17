import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { DEFAULT_JWT_SECRET } from './config/configuration';
import { AppLoggerService } from './log/app-logger.service';
import { TraceMiddleware } from './log/trace.middleware';
import { PUBLIC_URL_PREFIX, STORAGE_ROOT } from './media/storage.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.useLogger(app.get(AppLoggerService));

  if (process.env.NODE_ENV === 'production' && config.get<string>('jwtSecret') === DEFAULT_JWT_SECRET) {
    throw new Error('JWT_SECRET must be set to a strong value in production');
  }

  const traceMiddleware = app.get(TraceMiddleware);
  app.use(traceMiddleware.use.bind(traceMiddleware));

  app.useStaticAssets(STORAGE_ROOT, { prefix: PUBLIC_URL_PREFIX });

  app.enableCors({ origin: true, credentials: true });

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port, '0.0.0.0');
  Logger.log(`api listening on ${port}`, 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error(error, 'Bootstrap');
  process.exit(1);
});
