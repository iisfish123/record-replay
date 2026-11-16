import { z } from 'zod';

export const PhoneSchema = z.string().regex(/^1[3-9]\d{9}$/, '手机号格式不正确');
export const CodeSchema = z.string().regex(/^\d{4,8}$/, '验证码为 4-8 位数字');

export const SendCodeSchema = z.object({ phone: PhoneSchema });
export const LoginSchema = z.object({ phone: PhoneSchema, code: CodeSchema });
export const AskSchema = z.object({ question: z.string().min(1).max(200) });

export const CreatePersonaSchema = z.object({
  avatarUrl: z.string().min(1).max(512),
  voiceSampleUrl: z.string().min(1).max(512),
});

export const PersonaStatusSchema = z.enum(['pending', 'training', 'ready', 'failed']);
export const TaskStatusSchema = z.enum([
  'pending', 'answering', 'tts', 'rendering', 'done', 'failed',
]);

export type SendCodeDto = z.infer<typeof SendCodeSchema>;
export type LoginDto = z.infer<typeof LoginSchema>;
export type AskDto = z.infer<typeof AskSchema>;
export type CreatePersonaDto = z.infer<typeof CreatePersonaSchema>;
export type PersonaStatus = z.infer<typeof PersonaStatusSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
