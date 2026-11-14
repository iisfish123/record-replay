import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { CreatePersonaSchema } from '@record-replay/shared';
import { JwtGuard } from '../auth/jwt.guard';
import { PersonaService } from './persona.service';

@Controller('personas')
@UseGuards(JwtGuard)
export class PersonaController {
  constructor(private readonly personas: PersonaService) {}

  @Post()
  async create(@Req() req: any, @Body() body: unknown) {
    const parsed = CreatePersonaSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    return this.personas.create(req.user.sub, parsed.data.avatarUrl, parsed.data.voiceSampleUrl);
  }

  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    return this.personas.findOwned(id, req.user.sub);
  }
}
