import type { PersonaStatus } from '@record-replay/shared';
import { request } from './request';

export interface PersonaDto {
  id: string;
  userId: string;
  name: string | null;
  relation: string | null;
  avatarUrl: string;
  voiceSampleUrl: string;
  speakerId: string | null;
  status: PersonaStatus;
  error: string | null;
  createdAt: string;
}

/** 新建亲人必填字段。 */
export interface PersonaInput {
  name: string;
  relation: string;
  avatarUrl: string;
  voiceSampleUrl: string;
}

export function createPersona(input: PersonaInput): Promise<PersonaDto> {
  return request({ url: '/personas', method: 'POST', data: { ...input } });
}

export function getPersona(id: string): Promise<PersonaDto> {
  return request({ url: `/personas/${id}` });
}

export function listPersonas(): Promise<PersonaDto[]> {
  return request({ url: '/personas' });
}

export function updatePersona(id: string, patch: Partial<PersonaInput>): Promise<PersonaDto> {
  return request({ url: `/personas/${id}`, method: 'PUT', data: patch });
}

export function deletePersona(id: string): Promise<{ ok: boolean }> {
  return request({ url: `/personas/${id}`, method: 'DELETE' });
}
