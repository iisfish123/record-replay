import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RenderTask } from './entities/render-task.entity';
import { PersonaAskController, TaskController } from './task.controller';
import { TaskService } from './task.service';
import { PersonaModule } from '../persona/persona.module';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [TypeOrmModule.forFeature([RenderTask]), PersonaModule, ProvidersModule],
  controllers: [TaskController, PersonaAskController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
