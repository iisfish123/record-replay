import { describe, it, expect } from 'vitest';
import { API_BASE_URL, absoluteUrl } from '../src/config';

describe('config', () => {
  it('API_BASE_URL 默认去掉结尾斜杠', () => {
    expect(API_BASE_URL.endsWith('/')).toBe(false);
  });

  it('absoluteUrl 给相对路径拼上基址', () => {
    expect(absoluteUrl('/static/videos/a.mp4')).toBe(`${API_BASE_URL}/static/videos/a.mp4`);
  });

  it('absoluteUrl 对已是绝对地址的输入原样返回', () => {
    expect(absoluteUrl('https://v/x.mp4')).toBe('https://v/x.mp4');
  });
});
