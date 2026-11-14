import { describe, it, expect } from 'vitest';
import {
  PhoneSchema,
  SendCodeSchema,
  LoginSchema,
  AskSchema,
  PersonaStatusSchema,
  TaskStatusSchema,
} from './dto';

describe('shared dto', () => {
  it('接受合法手机号', () => {
    expect(PhoneSchema.safeParse('15920328477').success).toBe(true);
  });

  it('拒绝非法手机号', () => {
    expect(PhoneSchema.safeParse('12345').success).toBe(false);
  });

  it('拒绝非法第二位数字的手机号', () => {
    expect(PhoneSchema.safeParse('25920328477').success).toBe(false);
  });

  it('验证码必须 6 位数字', () => {
    expect(SendCodeSchema.safeParse({ phone: '15920328477' }).success).toBe(true);
    expect(LoginSchema.safeParse({ phone: '15920328477', code: 'abc' }).success).toBe(false);
    expect(LoginSchema.safeParse({ phone: '15920328477', code: '12345' }).success).toBe(false);
  });

  it('提问非空且不超过 200 字', () => {
    expect(AskSchema.safeParse({ question: '爸爸，你最近还好吗？' }).success).toBe(true);
    expect(AskSchema.safeParse({ question: '' }).success).toBe(false);
    expect(AskSchema.safeParse({ question: 'x'.repeat(201) }).success).toBe(false);
  });

  it('人物状态枚举完整', () => {
    expect(PersonaStatusSchema.options).toEqual([
      'pending', 'training', 'ready', 'failed',
    ]);
  });

  it('任务状态枚举完整', () => {
    expect(TaskStatusSchema.options).toEqual([
      'pending', 'answering', 'tts', 'rendering', 'done', 'failed',
    ]);
  });
});
