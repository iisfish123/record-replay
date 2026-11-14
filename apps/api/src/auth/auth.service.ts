import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { SmsService } from './sms.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly sms: SmsService,
    private readonly jwt: JwtService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async sendCode(phone: string): Promise<void> {
    await this.sms.send(phone);
  }

  async login(phone: string, code: string): Promise<{ token: string; userId: string }> {
    const ok = await this.sms.check(phone, code);
    if (!ok) throw new UnauthorizedException('验证码错误或已过期');

    let user = await this.users.findOne({ where: { phone } });
    if (!user) {
      user = await this.users.save(this.users.create({ phone }));
    }
    const token = await this.jwt.signAsync({ sub: user.id, phone: user.phone });
    return { token, userId: user.id };
  }
}
