import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPreconditionFailedResponse,
  ApiProduces,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../common/dto/api-error-response.dto';
import { ClaimStudyDto } from './dto/claim-study.dto';
import { CompleteStudyDto } from './dto/complete-study.dto';
import { ListStudiesQueryDto } from './dto/list-studies-query.dto';
import { StudyResponseDto } from './dto/study-response.dto';
import { StudiesService } from './studies.service';

@ApiTags('studies')
@Controller('studies')
export class StudiesController {
  constructor(private readonly studiesService: StudiesService) {}

  @Get()
  @ApiOperation({ summary: 'List studies', operationId: 'listStudies' })
  @ApiOkResponse({ type: StudyResponseDto, isArray: true })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  findAll(@Query() query: ListStudiesQueryDto) {
    return this.studiesService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a study by ID', operationId: 'getStudy' })
  @ApiParam({ name: 'id', example: 'study-001' })
  @ApiOkResponse({ type: StudyResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  findOne(@Param('id') id: string) {
    return this.studiesService.findOne(id);
  }

  @Get(':id/file')
  @ApiOperation({
    summary: 'Stream the DICOM file mapped to a study',
    operationId: 'getStudyFile',
  })
  @ApiParam({ name: 'id', example: 'study-001' })
  @ApiProduces('application/dicom')
  @ApiOkResponse({
    description: 'DICOM file bytes.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiNotFoundResponse({
    description: 'Study or mapped DICOM file not found.',
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
      },
    },
  })
  async getFile(@Param('id') id: string): Promise<StreamableFile> {
    const file = await this.studiesService.getFile(id);

    return new StreamableFile(createReadStream(file.path), {
      type: 'application/dicom',
      disposition: `inline; filename="${file.filename}"`,
      length: file.size,
    });
  }

  @Post(':id/claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Claim an unassigned study',
    operationId: 'claimStudy',
  })
  @ApiParam({ name: 'id', example: 'study-001' })
  @ApiOkResponse({ type: StudyResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiPreconditionFailedResponse({ type: ApiErrorResponseDto })
  claim(@Param('id') id: string, @Body() input: ClaimStudyDto) {
    return this.studiesService.claim(id, input);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete a study owned by the reviewer',
    operationId: 'completeStudy',
  })
  @ApiParam({ name: 'id', example: 'study-003' })
  @ApiOkResponse({ type: StudyResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiPreconditionFailedResponse({ type: ApiErrorResponseDto })
  complete(@Param('id') id: string, @Body() input: CompleteStudyDto) {
    return this.studiesService.complete(id, input);
  }
}
