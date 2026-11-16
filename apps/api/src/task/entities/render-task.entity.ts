import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('render_tasks')
export class RenderTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 36 })
  personaId: string;

  @Column({ type: 'text' })
  question: string;

  @Column({ type: 'text', nullable: true })
  answerText: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  audioUrl: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  videoUrl: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  remoteVideoUrl: string | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: 'pending' | 'answering' | 'tts' | 'rendering' | 'done' | 'failed';

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  finishedAt: Date | null;
}
