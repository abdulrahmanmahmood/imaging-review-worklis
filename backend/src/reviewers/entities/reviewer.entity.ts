import { Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { Study } from '../../studies/entities/study.entity';

@Entity({ name: 'reviewers' })
export class Reviewer {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  displayName!: string;

  @OneToMany(() => Study, (study) => study.owner)
  studies!: Study[];
}
