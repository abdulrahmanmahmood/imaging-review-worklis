import { ApiProperty } from '@nestjs/swagger';
import { Study } from '../entities/study.entity';
import { StudyStatus } from '../enums/study-status.enum';

export class StudyOwnerResponseDto {
  @ApiProperty({ example: 'reviewer-a' })
  id!: string;

  @ApiProperty({ example: 'Reviewer A' })
  displayName!: string;
}

export class StudyResponseDto {
  @ApiProperty({ example: 'study-001' })
  id!: string;

  @ApiProperty({ example: 'CT' })
  modality!: string;

  @ApiProperty({ example: '2026-01-01T08:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ enum: StudyStatus, example: StudyStatus.Unassigned })
  status!: StudyStatus;

  @ApiProperty({ type: String, example: 'reviewer-a', nullable: true })
  ownerId!: string | null;

  @ApiProperty({ type: () => StudyOwnerResponseDto, nullable: true })
  owner!: StudyOwnerResponseDto | null;

  @ApiProperty({
    type: String,
    example: 'Reviewed successfully.',
    nullable: true,
    maxLength: 1000,
  })
  reviewNote!: string | null;

  @ApiProperty({ example: 1, minimum: 1 })
  version!: number;

  static fromEntity(study: Study): StudyResponseDto {
    return {
      id: study.id,
      modality: study.modality,
      createdAt: study.createdAt,
      status: study.status,
      ownerId: study.ownerId,
      owner: study.owner
        ? {
            id: study.owner.id,
            displayName: study.owner.displayName,
          }
        : null,
      reviewNote: study.reviewNote,
      version: study.version,
    };
  }
}
