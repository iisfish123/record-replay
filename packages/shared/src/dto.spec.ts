import { describe, it, expect } from 'vitest';
import {
  PhoneSchema,
  SendCodeSchema,
  LoginSchema,
  AskSchema,
  CreatePersonaSchema,
  UpdatePersonaSchema,
  PersonaRelationSchema,
  PERSONA_RELATIONS,
  PersonaStatusSchema,
  TaskStatusSchema,
} from './dto';

const basePersona = {
  name: '爸爸',
  relation: '父亲',
  avatarUrl: 'http://x/a.jpg',
  voiceSampleUrl: 'http://x/v.mp3',
};

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

  it('验证码为 4-8 位数字', () => {
    expect(SendCodeSchema.safeParse({ phone: '15920328477' }).success).toBe(true);
    expect(LoginSchema.safeParse({ phone: '15920328477', code: 'abc' }).success).toBe(false);
    expect(LoginSchema.safeParse({ phone: '15920328477', code: '123' }).success).toBe(false);
    // 阿里云 Dypnsapi 按 min=5 生成验证码，5 位必须是合法长度
    expect(LoginSchema.safeParse({ phone: '15920328477', code: '12345' }).success).toBe(true);
  });

  it('提问非空且不超过 200 字', () => {
    expect(AskSchema.safeParse({ question: '爸爸，你最近还好吗？' }).success).toBe(true);
    expect(AskSchema.safeParse({ question: '' }).success).toBe(false);
    expect(AskSchema.safeParse({ question: 'x'.repeat(201) }).success).toBe(false);
  });

  it('创建人格需 name/relation/avatarUrl/voiceSampleUrl，URL 不超过 512 字', () => {
    expect(CreatePersonaSchema.safeParse(basePersona).success).toBe(true);
    expect(CreatePersonaSchema.safeParse({ ...basePersona, name: '' }).success).toBe(false);
    expect(CreatePersonaSchema.safeParse({ ...basePersona, name: 'x'.repeat(21) }).success).toBe(false);
    expect(CreatePersonaSchema.safeParse({ ...basePersona, relation: '邻居' }).success).toBe(false);
    expect(CreatePersonaSchema.safeParse({ ...basePersona, avatarUrl: 'x'.repeat(513) }).success).toBe(
      false,
    );
    expect(CreatePersonaSchema.safeParse({ avatarUrl: 'http://x/a.jpg' }).success).toBe(false);
  });

  it('关系仅接受预设亲属称谓', () => {
    expect(PERSONA_RELATIONS).toContain('父亲');
    expect(PERSONA_RELATIONS).toContain('女儿');
    expect(PersonaRelationSchema.safeParse('母亲').success).toBe(true);
    expect(PersonaRelationSchema.safeParse('朋友').success).toBe(false);
  });

  it('更新人格时各字段均可选', () => {
    expect(UpdatePersonaSchema.safeParse({}).success).toBe(true);
    expect(UpdatePersonaSchema.safeParse({ name: '妈妈' }).success).toBe(true);
    expect(UpdatePersonaSchema.safeParse({ relation: '母亲' }).success).toBe(true);
    expect(UpdatePersonaSchema.safeParse({ relation: '室友' }).success).toBe(false);
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
