import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiErrorCode } from '../errors/api-error-code.enum';
import { ApiErrorBody } from '../errors/api.exception';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();

    const error = this.toApiError(exception);

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        `Unhandled error for ${request.method} ${request.originalUrl}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(error.statusCode).json(error);
  }

  private toApiError(exception: unknown): ApiErrorBody {
    if (!(exception instanceof HttpException)) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ApiErrorCode.InternalError,
        message: 'An unexpected error occurred.',
      };
    }

    const statusCode = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    if (this.isApiErrorBody(exceptionResponse)) {
      return exceptionResponse;
    }

    if (statusCode === 404) {
      return {
        statusCode,
        code: ApiErrorCode.RouteNotFound,
        message: 'Route not found.',
      };
    }

    return {
      statusCode,
      code: ApiErrorCode.InvalidInput,
      message: 'Request failed.',
    };
  }

  private isApiErrorBody(value: unknown): value is ApiErrorBody {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const candidate = value as Partial<ApiErrorBody>;
    return (
      typeof candidate.statusCode === 'number' &&
      typeof candidate.code === 'string' &&
      typeof candidate.message === 'string'
    );
  }
}
