import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Persona } from './entities/persona.entity';

@Injectable()
export class PersonaService {
  constructor(@InjectRepository(Persona) private readonly repo: Repository<Persona>) {}

  async create(userId: string, avatarUrl: string, voiceSampleUrl: string): Promise<Persona> {
    return this.repo.save(this.repo.create({ userId, avatarUrl, voiceSampleUrl, status: 'pending' }));
  }

  async findOwned(id: string, userId: string): Promise<Persona> {
    const persona = await this.repo.findOne({ where: { id } });
    if (!persona) throw new NotFoundException('人格不存在');
    if (persona.userId !== userId) throw new ForbiddenException('无权访问该人格');
    return persona;
  }

  async updateStatus(id: string, status: Persona['status'], patch: Partial<Persona> = {}): Promise<void> {
    await this.repo.update(id, { status, ...patch });
  }
}
