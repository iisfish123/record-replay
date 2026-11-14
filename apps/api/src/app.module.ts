import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { MediaModule } from './media/media.module';
import { PersonaModule } from './persona/persona.module';

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
    PersonaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
