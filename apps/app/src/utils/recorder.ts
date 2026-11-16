import { ref, onUnmounted } from 'vue';

interface RecorderStopResult {
  tempFilePath: string;
}

export interface RecorderManagerLike {
  start(options: { duration: number; format: string }): void;
  stop(): void;
  onStop(cb: (res: RecorderStopResult) => void): void;
  onError(cb: (err: { errMsg?: string }) => void): void;
}

export const MAX_RECORD_SECONDS = 20;

export function useRecorder(maxSeconds = MAX_RECORD_SECONDS) {
  const recording = ref(false);
  const seconds = ref(0);
  const tempFilePath = ref('');
  let timer: ReturnType<typeof setInterval> | null = null;

  const manager = uni.getRecorderManager() as unknown as RecorderManagerLike;

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  manager.onStop((res) => {
    recording.value = false;
    stopTimer();
    tempFilePath.value = res.tempFilePath;
  });

  manager.onError((err) => {
    recording.value = false;
    stopTimer();
    uni.showToast({ title: err?.errMsg ?? '录音失败', icon: 'none' });
  });

  function start() {
    tempFilePath.value = '';
    seconds.value = 0;
    recording.value = true;
    manager.start({ duration: maxSeconds * 1000, format: 'mp3' });
    stopTimer();
    timer = setInterval(() => {
      seconds.value += 1;
      if (seconds.value >= maxSeconds) manager.stop();
    }, 1000);
  }

  function stop() {
    if (recording.value) manager.stop();
  }

  onUnmounted(stopTimer);

  return { recording, seconds, tempFilePath, start, stop, maxSeconds };
}
