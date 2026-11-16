import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/api/request', () => ({ request: vi.fn(), setAuthToken: vi.fn(), getAuthToken: vi.fn() }));
import { request } from '../src/api/request';
import { createPersona, getPersona } from '../src/api/persona';

const mocked = request as unknown as ReturnType<typeof vi.fn>;

describe('persona api', () => {
  it('createPersona 传 avatarUrl 与 voiceSampleUrl', async () => {
    mocked.mockResolvedValue({ id: 'p1', status: 'pending' });
    const res = await createPersona('/static/uploads/a.jpg', '/static/uploads/v.mp3');
    expect(mocked).toHaveBeenCalledWith({
      url: '/personas',
      method: 'POST',
      data: { avatarUrl: '/static/uploads/a.jpg', voiceSampleUrl: '/static/uploads/v.mp3' },
    });
    expect(res.id).toBe('p1');
  });

  it('getPersona 走 GET /personas/:id', async () => {
    mocked.mockResolvedValue({ id: 'p1', status: 'ready' });
    await getPersona('p1');
    expect(mocked).toHaveBeenCalledWith({ url: '/personas/p1' });
  });
});
