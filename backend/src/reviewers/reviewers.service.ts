import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReviewerResponseDto } from './dto/reviewer-response.dto';
import { Reviewer } from './entities/reviewer.entity';

@Injectable()
export class ReviewersService {
  constructor(
    @InjectRepository(Reviewer)
    private readonly reviewersRepository: Repository<Reviewer>,
  ) {}

  async findAll(): Promise<ReviewerResponseDto[]> {
    const reviewers = await this.reviewersRepository.find({
      order: { id: 'ASC' },
    });

    return reviewers.map((reviewer) =>
      ReviewerResponseDto.fromEntity(reviewer),
    );
  }
}
