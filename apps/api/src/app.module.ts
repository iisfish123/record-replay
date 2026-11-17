import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { AccessLogInterceptor } from './log/access-log.interceptor';
import { AllExceptionsFilter } from './log/all-exceptions.filter';
import { LogModule } from './log/log.module';
import { MediaModule } from './media/media.module';
import { PersonaModule } from './persona/persona.module';
import { ProvidersModule } from './providers/providers.module';
import { TaskModule } from './task/task.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], envFilePath: ['.env.development', '.env'] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'mysql',
        host: cfg.get<string>('mysql.host'),
        port: cfg.get<number>('mysql.port'),
        username: cfg.get<string>('mysql.username'),
        password: cfg.get<string>('mysql.password'),
        database: cfg.get<string>('mysql.database'),
        autoLoadEntities: true,
        synchronize: true,
        timezone: 'Z',
      }),
    }),
    AuthModule,
    MediaModule,
    ProvidersModule,
    PersonaModule,
    TaskModule,
    LogModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useExisting: AccessLogInterceptor },
    { provide: APP_FILTER, useExisting: AllExceptionsFilter },
  ],
})
export class AppModule {}
