import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { CreatePersonaSchema, UpdatePersonaSchema } from '@record-replay/shared';
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
    return this.personas.create(req.user.sub, parsed.data);
  }

  @Get()
  async list(@Req() req: any) {
    return this.personas.list(req.user.sub);
  }

  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    return this.personas.findOwned(id, req.user.sub);
  }

  @Put(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: unknown) {
    const parsed = UpdatePersonaSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    return this.personas.update(id, req.user.sub, parsed.data);
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    await this.personas.remove(id, req.user.sub);
    return { ok: true };
  }
}
