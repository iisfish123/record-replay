import type { PersonaStatus } from '@record-replay/shared';
import { request } from './request';

export interface PersonaDto {
  id: string;
  userId: string;
  avatarUrl: string;
  voiceSampleUrl: string;
  speakerId: string | null;
  status: PersonaStatus;
  error: string | null;
  createdAt: string;
}

export function createPersona(avatarUrl: string, voiceSampleUrl: string): Promise<PersonaDto> {
  return request({ url: '/personas', method: 'POST', data: { avatarUrl, voiceSampleUrl } });
}

export function getPersona(id: string): Promise<PersonaDto> {
  return request({ url: `/personas/${id}` });
}

export function listPersonas(): Promise<PersonaDto[]> {
  return request({ url: '/personas' });
}

export function updatePersona(
  id: string,
  patch: { avatarUrl?: string; voiceSampleUrl?: string },
): Promise<PersonaDto> {
  return request({ url: `/personas/${id}`, method: 'PUT', data: patch });
}

export function deletePersona(id: string): Promise<{ ok: boolean }> {
  return request({ url: `/personas/${id}`, method: 'DELETE' });
}
