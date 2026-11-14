import { DeepSeekChatProvider } from './chat.provider';

describe('DeepSeekChatProvider', () => {
  const cfg = { apiKey: 'k', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' };
  const persona = { avatarUrl: 'a', voiceSampleUrl: 'v' };

  it('拼装人格 system prompt 并限制回答长度', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '孩子，我很好，别担心。' } }] }),
    });
    const provider = new DeepSeekChatProvider(cfg as any, fetchMock as any, 70);

    const answer = await provider.answer(persona as any, '爸，你最近好吗？');

    expect(answer).toBe('孩子，我很好，别担心。');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('deepseek-flash');
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('逝去');
    expect(body.messages[1]).toEqual({ role: 'user', content: '爸，你最近好吗？' });
  });

  it('上游失败时抛错', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const provider = new DeepSeekChatProvider(cfg as any, fetchMock as any, 70);
    await expect(provider.answer(persona as any, 'hi')).rejects.toThrow(/DeepSeek/);
  });
});
