import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { LoginSchema, SendCodeSchema } from '@record-replay/shared';
import { AuthService } from './auth.service';

@Controller('auth/sms')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('send')
  @HttpCode(200)
  async send(@Body() body: unknown) {
    const parsed = SendCodeSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    await this.auth.sendCode(parsed.data.phone);
    return { ok: true };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown) {
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    return this.auth.login(parsed.data.phone, parsed.data.code);
  }
}
