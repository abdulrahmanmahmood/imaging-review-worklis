import { Type, Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ClaimStudyDto {
  @ApiProperty({ example: 'reviewer-a', maxLength: 64 })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  reviewerId!: string;

  @ApiProperty({ example: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
