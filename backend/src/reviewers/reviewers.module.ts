import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reviewer } from './entities/reviewer.entity';
import { ReviewersController } from './reviewers.controller';
import { ReviewersService } from './reviewers.service';

@Module({
  imports: [TypeOrmModule.forFeature([Reviewer])],
  controllers: [ReviewersController],
  providers: [ReviewersService],
})
export class ReviewersModule {}
