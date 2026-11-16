import type { TaskStatus } from '@record-replay/shared';
import { request } from './request';

export interface TaskDto {
  id: string;
  personaId: string;
  question: string;
  answerText: string | null;
  audioUrl: string | null;
  videoUrl: string | null;
  status: TaskStatus;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export function ask(personaId: string, question: string): Promise<{ taskId: string }> {
  return request({ url: `/personas/${personaId}/ask`, method: 'POST', data: { question } });
}

export function getTask(id: string): Promise<TaskDto> {
  return request({ url: `/tasks/${id}` });
}
