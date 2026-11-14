import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtGuard } from '../auth/jwt.guard';
import { MediaService } from './media.service';

@Controller('media')
@UseGuards(JwtGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('缺少文件');
    const kind = file.mimetype.startsWith('image/') ? 'image' : 'audio';
    const url = await this.media.saveUpload(file, kind);
    return { url, kind };
  }
}
