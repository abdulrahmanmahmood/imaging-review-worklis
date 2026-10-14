import {
  HttpStatus,
  INestApplication,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiErrorCode } from './common/errors/api-error-code.enum';
import { ApiException } from './common/errors/api.exception';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

export interface ApplicationSetupOptions {
  swagger?: boolean;
}

function validationDetails(errors: ValidationError[]) {
  return errors.flatMap((error) =>
    Object.values(error.constraints ?? {}).map((message) => ({
      field: error.property,
      message,
    })),
  );
}

export function configureApplication(
  app: INestApplication,
  options: ApplicationSetupOptions = {},
): void {
  app.setGlobalPrefix('api');
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) =>
        new ApiException(
          HttpStatus.BAD_REQUEST,
          ApiErrorCode.InvalidInput,
          'Request validation failed.',
          { details: validationDetails(errors) },
        ),
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  if (options.swagger === false) {
    return;
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Imaging Review Worklist API')
    .setDescription('API for claiming and reviewing DICOM imaging studies.')
    .setVersion('1.0.0')
    .addTag('reviewers')
    .addTag('studies')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument, {
    useGlobalPrefix: true,
    raw: ['json'],
    jsonDocumentUrl: '/openapi.json',
  });
}
