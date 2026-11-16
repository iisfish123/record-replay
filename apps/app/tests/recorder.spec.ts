import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import {
  isSampleLongEnough,
  MAX_RECORD_SECONDS,
  MIN_SAMPLE_SECONDS,
  useRecorder,
} from '@/utils/recorder';

/** useRecorder 内部注册了 onUnmounted，需在组件上下文中调用。 */
function withSetup<T>(composable: () => T): T {
  let result!: T;
  const app = createApp(
    defineComponent({
      setup() {
        result = composable();
        return () => h('div');
      },
    }),
  );
  app.mount(document.createElement('div'));
  return result;
}

class FakeMediaRecorder {
  static last: FakeMediaRecorder;
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly stream: unknown) {
    FakeMediaRecorder.last = this;
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['abc'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

function stubMediaDevices(getUserMedia: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
}

describe('useRecorder', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('拿不到麦克风时抛错，并留下可展示的原因（页面据此 toast 提示）', async () => {
    stubMediaDevices(vi.fn().mockRejectedValue(new Error('NotAllowedError')));
    const recorder = withSetup(() => useRecorder());

    await expect(recorder.start()).rejects.toThrow('无法获取麦克风权限');
    expect(recorder.error.value).toBe('无法获取麦克风权限');
    expect(recorder.recording.value).toBe(false);
  });

  it('录音停止后产出 webm 文件（真机格式，需服务端转 mp3）', async () => {
    stubMediaDevices(vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }));
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const recorder = withSetup(() => useRecorder());

    await recorder.start();
    expect(recorder.recording.value).toBe(true);

    recorder.stop();

    expect(recorder.recording.value).toBe(false);
    expect(recorder.tempFile.value?.name).toMatch(/^voice-\d+\.webm$/);
    expect(recorder.tempFile.value?.type).toBe('audio/webm');
  });

  it('达到上限秒数后自动停止', async () => {
    vi.useFakeTimers();
    stubMediaDevices(vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }));
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const recorder = withSetup(() => useRecorder(3));

    await recorder.start();
    vi.advanceTimersByTime(3000);

    expect(recorder.recording.value).toBe(false);
  });
});

describe('样本时长校验', () => {
  it('上游要求不少于 10 秒', () => {
    expect(MIN_SAMPLE_SECONDS).toBe(10);
    expect(MAX_RECORD_SECONDS).toBeGreaterThanOrEqual(MIN_SAMPLE_SECONDS);
    expect(isSampleLongEnough(9)).toBe(false);
    expect(isSampleLongEnough(10)).toBe(true);
  });
});
