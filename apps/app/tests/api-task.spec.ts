import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/api/request', () => ({ request: vi.fn(), setAuthToken: vi.fn(), getAuthToken: vi.fn() }));
import { request } from '../src/api/request';
import { ask, getTask } from '../src/api/task';

const mocked = request as unknown as ReturnType<typeof vi.fn>;

describe('task api', () => {
  it('ask 走 POST /personas/:id/ask', async () => {
    mocked.mockResolvedValue({ taskId: 't1' });
    const res = await ask('p1', '爸爸，你最近还好吗？');
    expect(mocked).toHaveBeenCalledWith({
      url: '/personas/p1/ask',
      method: 'POST',
      data: { question: '爸爸，你最近还好吗？' },
    });
    expect(res).toEqual({ taskId: 't1' });
  });

  it('getTask 走 GET /tasks/:id', async () => {
    mocked.mockResolvedValue({ id: 't1', status: 'done', videoUrl: '/static/videos/x.mp4' });
    const res = await getTask('t1');
    expect(mocked).toHaveBeenCalledWith({ url: '/tasks/t1' });
    expect(res.status).toBe('done');
  });
});
