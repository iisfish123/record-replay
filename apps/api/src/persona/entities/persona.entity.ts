import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('personas')
export class Persona {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 36 })
  userId: string;

  /** 昵称或姓名。历史数据可能为空。 */
  @Column({ type: 'varchar', length: 32, nullable: true })
  name: string | null;

  /** 与用户的关系，取自 PERSONA_RELATIONS 预设。 */
  @Column({ type: 'varchar', length: 16, nullable: true })
  relation: string | null;

  @Column({ type: 'varchar', length: 512 })
  avatarUrl: string;

  @Column({ type: 'varchar', length: 512 })
  voiceSampleUrl: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  speakerId: string | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: 'pending' | 'training' | 'ready' | 'failed';

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
