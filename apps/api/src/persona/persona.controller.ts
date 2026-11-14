import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { PersonaService } from './persona.service';

@Controller('personas')
@UseGuards(JwtGuard)
export class PersonaController {
  constructor(private readonly personas: PersonaService) {}

  @Post()
  async create(@Req() req: any, @Body() body: { avatarUrl: string; voiceSampleUrl: string }) {
    return this.personas.create(req.user.sub, body.avatarUrl, body.voiceSampleUrl);
  }

  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    return this.personas.findOwned(id, req.user.sub);
  }
}
