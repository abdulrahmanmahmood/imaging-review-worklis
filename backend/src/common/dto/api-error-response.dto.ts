import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ example: 'INVALID_INPUT' })
  code!: string;

  @ApiProperty({ example: 'Request validation failed.' })
  message!: string;

  @ApiPropertyOptional({ type: Object })
  details?: unknown;

  @ApiPropertyOptional({ type: Object })
  current?: unknown;
}
