import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { STORAGE_ROOT, toPublicUrl } from './storage.config';

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

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
    const ext = extname(file.originalname) || (kind === 'image' ? '.jpg' : '.mp3');
    const name = `${randomUUID()}${ext}`;
    await writeFile(join(dir, name), file.buffer);
    return toPublicUrl(this.cfg.get<string>('publicBaseUrl')!, `uploads/${name}`);
  }
}
