import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReviewerResponseDto } from './dto/reviewer-response.dto';
import { ReviewersService } from './reviewers.service';

@ApiTags('reviewers')
@Controller('reviewers')
export class ReviewersController {
  constructor(private readonly reviewersService: ReviewersService) {}

  @Get()
  @ApiOperation({ summary: 'List reviewers', operationId: 'listReviewers' })
  @ApiOkResponse({ type: ReviewerResponseDto, isArray: true })
  findAll() {
    return this.reviewersService.findAll();
  }
}
