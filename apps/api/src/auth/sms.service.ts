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
    // 验证码必须交由阿里云动态生成（占位符 ##code##），否则 CheckSmsVerifyCode 无法校验
    const req = new $Dypnsapi.SendSmsVerifyCodeRequest({
      phoneNumber: phone,
      signName: this.options.signName,
      templateCode: this.options.templateCode,
      templateParam: JSON.stringify({ code: '##code##', min: '5' }),
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
    const body = resp?.body ?? {};
    const code = body.code ?? body.Code;
    // 核验结果仅以 Model.VerifyResult（PASS/UNKNOWN）为准；Code=OK 只代表请求成功
    const result = body.model?.verifyResult ?? body.Model?.VerifyResult;
    return code === 'OK' && result === 'PASS';
  }
}
