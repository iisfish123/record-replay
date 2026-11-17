import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { STORAGE_ROOT, toPublicUrl } from './storage.config';

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** 参考图最长边压缩到 1024px：足够清晰，体积通常 < 200KB，避免 MiniMax 下载超时。 */
const IMAGE_MAX_DIMENSION = 1024;
const IMAGE_QUALITY = 80;

@Injectable()
export class MediaService {
  constructor(private readonly cfg: ConfigService) {}

  async saveUpload(
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    kind: 'image' | 'audio',
  ): Promise<string> {
    if (!file) throw new BadRequestException('缺少文件');
    if (kind === 'image' && file.size > IMAGE_MAX_BYTES) {
      throw new BadRequestException('图片不能超过 5MB');
    }
    const dir = join(STORAGE_ROOT, 'uploads');
    await mkdir(dir, { recursive: true });

    let buffer = file.buffer;
    let ext = extname(file.originalname) || (kind === 'image' ? '.jpg' : '.mp3');

    if (kind === 'image') {
      // 压缩并转 JPEG：统一格式 + 缩小体积，避免下游（MiniMax 等）因图片过大/下载慢而失败
      buffer = await sharp(file.buffer)
        .rotate()
        .resize({ width: IMAGE_MAX_DIMENSION, height: IMAGE_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: IMAGE_QUALITY, mozjpeg: true })
        .toBuffer();
      ext = '.jpg';
    }

    const name = `${randomUUID()}${ext}`;
    await writeFile(join(dir, name), buffer);
    return toPublicUrl(this.cfg.get<string>('publicBaseUrl')!, `uploads/${name}`);
  }
}
