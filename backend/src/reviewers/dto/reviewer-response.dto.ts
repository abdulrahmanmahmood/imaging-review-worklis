import { ApiProperty } from '@nestjs/swagger';
import { Reviewer } from '../entities/reviewer.entity';

export class ReviewerResponseDto {
  @ApiProperty({ example: 'reviewer-a' })
  id!: string;

  @ApiProperty({ example: 'Reviewer A' })
  displayName!: string;

  static fromEntity(reviewer: Reviewer): ReviewerResponseDto {
    return {
      id: reviewer.id,
      displayName: reviewer.displayName,
    };
  }
}
