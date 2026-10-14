import { HttpException, HttpStatus } from '@nestjs/common';
import { ApiErrorCode } from './api-error-code.enum';

export interface ApiErrorBody {
  statusCode: HttpStatus;
  code: ApiErrorCode;
  message: string;
  details?: unknown;
  current?: unknown;
}

export class ApiException extends HttpException {
  constructor(
    statusCode: HttpStatus,
    code: ApiErrorCode,
    message: string,
    additionalFields: Pick<ApiErrorBody, 'details' | 'current'> = {},
  ) {
    super({ statusCode, code, message, ...additionalFields }, statusCode);
  }
}
