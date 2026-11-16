import { ref, onUnmounted } from 'vue';

export const MAX_RECORD_SECONDS = 20;

export function useRecorder(maxSeconds = MAX_RECORD_SECONDS) {
  const recording = ref(false);
  const seconds = ref(0);
  const tempFile = ref<File | null>(null);
  const error = ref('');

  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function cleanupStream() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  async function start() {
    if (recording.value) return;
    error.value = '';
    tempFile.value = null;
    chunks = [];

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      error.value = '无法获取麦克风权限';
      throw new Error('无法获取麦克风权限');
    }

    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      const mime = mediaRecorder?.mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type: mime });
      const ext = mime.includes('mp4') ? 'm4a' : mime.includes('webm') ? 'webm' : 'ogg';
      tempFile.value = new File([blob], `voice-${Date.now()}.${ext}`, { type: mime });
      cleanupStream();
    };
    mediaRecorder.onerror = () => {
      error.value = '录音失败';
      cleanupStream();
    };

    mediaRecorder.start();
    recording.value = true;
    seconds.value = 0;
    stopTimer();
    timer = setInterval(() => {
      seconds.value += 1;
      if (seconds.value >= maxSeconds) stop();
    }, 1000);
  }

  function stop() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    recording.value = false;
    stopTimer();
  }

  onUnmounted(() => {
    stop();
    cleanupStream();
  });

  return { recording, seconds, tempFile, error, start, stop, maxSeconds };
}
