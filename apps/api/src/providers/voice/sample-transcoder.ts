import { spawn } from 'node:child_process';

/**
 * 把任意可解码的音频转成 mp3。
 * MiniMax 音色复刻只接受 mp3/m4a/wav，而真机 WebView 的 MediaRecorder 录出的是 webm/ogg，
 * 因此非白名单格式必须先转码，否则复刻会被上游拒绝。
 */
export function transcodeToMp3(
  audio: Buffer,
  ffmpegPath: string = process.env.FFMPEG_PATH ?? 'ffmpeg',
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-vn',
      '-ac',
      '1',
      '-ar',
      '32000',
      '-b:a',
      '128k',
      '-f',
      'mp3',
      'pipe:1',
    ]);

    const chunks: Buffer[] = [];
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      reject(new Error(`ffmpeg 启动失败（请确认已安装 ffmpeg）: ${err.message}`));
    });
    child.on('close', (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
        return;
      }
      reject(new Error(`音频转码失败: ${stderr.trim().slice(0, 200) || `ffmpeg 退出码 ${code}`}`));
    });

    // 上游进程可能在读完整段音频前退出，忽略由此产生的 EPIPE。
    child.stdin.on('error', () => undefined);
    child.stdin.end(audio);
  });
}
