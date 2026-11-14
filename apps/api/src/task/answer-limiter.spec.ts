import { limitAnswer } from './answer-limiter';

describe('limitAnswer', () => {
  it('短文本原样返回', () => {
    expect(limitAnswer('想你了，我很好。', 70)).toBe('想你了，我很好。');
  });

  it('超长时在标点处截断并补省略号', () => {
    const long = '今天天气不错。' + '我很想你。'.repeat(30);
    const out = limitAnswer(long, 20);
    expect(out.length).toBeLessThanOrEqual(21);
    expect(out.endsWith('…')).toBe(true);
  });

  it('无标点时硬截断', () => {
    const out = limitAnswer('啊'.repeat(100), 10);
    expect(out.length).toBe(11);
    expect(out.endsWith('…')).toBe(true);
  });
});
