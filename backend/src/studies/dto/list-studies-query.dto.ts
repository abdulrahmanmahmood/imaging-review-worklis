import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { StudyStatus } from '../enums/study-status.enum';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ListStudiesQueryDto {
  @ApiPropertyOptional({ enum: StudyStatus, example: StudyStatus.Unassigned })
  @IsOptional()
  @IsEnum(StudyStatus)
  status?: StudyStatus;

  @ApiPropertyOptional({ example: 'CT', maxLength: 16 })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  modality?: string;
}
