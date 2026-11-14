import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import Credential, { Config } from '@alicloud/credentials';
import * as $OpenApi from '@alicloud/openapi-client';
import Dypnsapi20170525 from '@alicloud/dypnsapi20170525';
import { User } from './entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SMS_CLIENT, SMS_OPTIONS, SmsService } from './sms.service';
import { JwtGuard } from './jwt.guard';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('jwtSecret'),
        signOptions: { expiresIn: cfg.get<string>('jwtExpiresIn') as JwtSignOptions['expiresIn'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SmsService,
    JwtGuard,
    {
      provide: SMS_OPTIONS,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        signName: cfg.get<string>('aliyun.signName'),
        templateCode: cfg.get<string>('aliyun.templateCode'),
      }),
    },
    {
      provide: SMS_CLIENT,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const credential = new Credential(
          new Config({
            type: 'access_key',
            accessKeyId: cfg.get<string>('aliyun.accessKeyId'),
            accessKeySecret: cfg.get<string>('aliyun.accessKeySecret'),
          }),
        );
        const openApiConfig = new $OpenApi.Config({ credential });
        openApiConfig.endpoint = 'dypnsapi.aliyuncs.com';
        return new Dypnsapi20170525(openApiConfig);
      },
    },
  ],
  exports: [JwtModule, JwtGuard, SmsService],
})
export class AuthModule {}
