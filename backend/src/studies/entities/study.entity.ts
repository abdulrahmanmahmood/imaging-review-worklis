import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  VersionColumn,
} from 'typeorm';
import { Reviewer } from '../../reviewers/entities/reviewer.entity';
import { StudyStatus } from '../enums/study-status.enum';

@Entity({ name: 'studies' })
@Index('idx_studies_worklist', ['status', 'modality', 'createdAt', 'id'])
export class Study {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 16 })
  modality!: string;

  @Column({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({
    type: 'enum',
    enum: StudyStatus,
    enumName: 'study_status',
    default: StudyStatus.Unassigned,
  })
  status!: StudyStatus;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ownerId!: string | null;

  @ManyToOne(() => Reviewer, (reviewer) => reviewer.studies, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'ownerId' })
  owner!: Reviewer | null;

  @Column({ type: 'text', nullable: true })
  reviewNote!: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @Column({ type: 'varchar', length: 64 })
  dicomFileKey!: string;
}
