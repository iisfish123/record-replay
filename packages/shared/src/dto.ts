import { z } from 'zod';

export const PhoneSchema = z.string().regex(/^1[3-9]\d{9}$/, '手机号格式不正确');
export const CodeSchema = z.string().regex(/^\d{4,8}$/, '验证码为 4-8 位数字');

export const SendCodeSchema = z.object({ phone: PhoneSchema });
export const LoginSchema = z.object({ phone: PhoneSchema, code: CodeSchema });
export const AskSchema = z.object({ question: z.string().min(1).max(200) });

/** 亲人关系预设，前端下拉直接引用。 */
export const PERSONA_RELATIONS = [
  '父亲', '母亲', '儿子', '女儿',
  '爷爷', '奶奶', '外公', '外婆',
  '丈夫', '妻子', '哥哥', '姐姐', '弟弟', '妹妹',
  '其他',
] as const;

export const PersonaRelationSchema = z.enum(PERSONA_RELATIONS);
/** 昵称或姓名。 */
export const PersonaNameSchema = z.string().min(1, '请填写昵称或姓名').max(20, '昵称最长 20 字');

export const CreatePersonaSchema = z.object({
  name: PersonaNameSchema,
  relation: PersonaRelationSchema,
  avatarUrl: z.string().min(1).max(512),
  voiceSampleUrl: z.string().min(1).max(512),
});

/** 修改亲人资料：昵称/关系/头像/语音样本均可单独更新；音色复用已有 speakerId，不重新训练。 */
export const UpdatePersonaSchema = z.object({
  name: PersonaNameSchema.optional(),
  relation: PersonaRelationSchema.optional(),
  avatarUrl: z.string().min(1).max(512).optional(),
  voiceSampleUrl: z.string().min(1).max(512).optional(),
});

export const PersonaStatusSchema = z.enum(['pending', 'training', 'ready', 'failed']);
export const TaskStatusSchema = z.enum([
  'pending', 'answering', 'tts', 'rendering', 'done', 'failed',
]);

export type SendCodeDto = z.infer<typeof SendCodeSchema>;
export type LoginDto = z.infer<typeof LoginSchema>;
export type AskDto = z.infer<typeof AskSchema>;
export type CreatePersonaDto = z.infer<typeof CreatePersonaSchema>;
export type UpdatePersonaDto = z.infer<typeof UpdatePersonaSchema>;
export type PersonaRelation = z.infer<typeof PersonaRelationSchema>;
export type PersonaStatus = z.infer<typeof PersonaStatusSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
