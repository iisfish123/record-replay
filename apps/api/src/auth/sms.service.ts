import { Inject, Injectable } from '@nestjs/common';
import * as $Dypnsapi from '@alicloud/dypnsapi20170525';
import * as $Util from '@alicloud/tea-util';

export interface SmsClient {
  sendSmsVerifyCodeWithOptions(req: $Dypnsapi.SendSmsVerifyCodeRequest, runtime?: $Util.RuntimeOptions): Promise<any>;
  checkSmsVerifyCodeWithOptions(req: $Dypnsapi.CheckSmsVerifyCodeRequest, runtime?: $Util.RuntimeOptions): Promise<any>;
}

export interface SmsOptions {
  signName: string;
  templateCode: string;
}

export const SMS_CLIENT = Symbol('SMS_CLIENT');
export const SMS_OPTIONS = Symbol('SMS_OPTIONS');

@Injectable()
export class SmsService {
  constructor(
    @Inject(SMS_CLIENT) private readonly client: SmsClient,
    @Inject(SMS_OPTIONS) private readonly options: SmsOptions,
  ) {}

  async send(phone: string): Promise<void> {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const req = new $Dypnsapi.SendSmsVerifyCodeRequest({
      phoneNumber: phone,
      signName: this.options.signName,
      templateCode: this.options.templateCode,
      templateParam: JSON.stringify({ code, min: '5' }),
    });
    const resp = await this.client.sendSmsVerifyCodeWithOptions(req, new $Util.RuntimeOptions({}));
    const bodyCode = resp?.body?.code ?? resp?.body?.Code;
    if (bodyCode !== 'OK') {
      throw new Error(`短信发送失败: ${JSON.stringify(resp?.body ?? resp)}`);
    }
  }

  async check(phone: string, verifyCode: string): Promise<boolean> {
    const req = new $Dypnsapi.CheckSmsVerifyCodeRequest({
      phoneNumber: phone,
      verifyCode,
      countryCode: '86',
    });
    const resp = await this.client.checkSmsVerifyCodeWithOptions(req, new $Util.RuntimeOptions({}));
    return (resp?.body?.code ?? resp?.body?.Code) === 'OK';
  }
}
