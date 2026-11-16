import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AskSchema } from '@record-replay/shared';
import { JwtGuard } from '../auth/jwt.guard';
import { PersonaService } from '../persona/persona.service';
import { TaskService } from './task.service';

@Controller('tasks')
@UseGuards(JwtGuard)
export class TaskController {
  constructor(
    private readonly tasks: TaskService,
    private readonly personas: PersonaService,
  ) {}

  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const task = await this.tasks.find(id);
    if (!task) throw new NotFoundException('任务不存在');
    await this.personas.findOwned(task.personaId, req.user.sub);
    return task;
  }
}

@Controller('personas')
@UseGuards(JwtGuard)
export class PersonaAskController {
  constructor(
    private readonly tasks: TaskService,
    private readonly personas: PersonaService,
  ) {}

  @Post(':personaId/ask')
  async ask(@Req() req: any, @Param('personaId') personaId: string, @Body() body: unknown) {
    const parsed = AskSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    const persona = await this.personas.findOwned(personaId, req.user.sub);
    if (persona.status !== 'ready') throw new BadRequestException('人格尚未就绪');
    const task = await this.tasks.create(persona, parsed.data.question);
    return { taskId: task.id };
  }
}
