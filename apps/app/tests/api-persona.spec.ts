import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/api/request', () => ({ request: vi.fn(), setAuthToken: vi.fn(), getAuthToken: vi.fn() }));
import { request } from '../src/api/request';
import { createPersona, getPersona, listPersonas, updatePersona, deletePersona } from '../src/api/persona';

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

  it('listPersonas 走 GET /personas', async () => {
    mocked.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    const res = await listPersonas();
    expect(mocked).toHaveBeenCalledWith({ url: '/personas' });
    expect(res).toHaveLength(2);
  });

  it('updatePersona 走 PUT /personas/:id 并只传改动字段', async () => {
    mocked.mockResolvedValue({ id: 'p1', avatarUrl: '/new.jpg' });
    const res = await updatePersona('p1', { avatarUrl: '/new.jpg' });
    expect(mocked).toHaveBeenCalledWith({
      url: '/personas/p1',
      method: 'PUT',
      data: { avatarUrl: '/new.jpg' },
    });
    expect(res.avatarUrl).toBe('/new.jpg');
  });

  it('deletePersona 走 DELETE /personas/:id', async () => {
    mocked.mockResolvedValue({ ok: true });
    const res = await deletePersona('p1');
    expect(mocked).toHaveBeenCalledWith({ url: '/personas/p1', method: 'DELETE' });
    expect(res.ok).toBe(true);
  });
});
