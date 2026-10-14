import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reviewer } from '../reviewers/entities/reviewer.entity';
import { Study } from './entities/study.entity';
import { StudiesService } from './studies.service';
import { StudiesController } from './studies.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Study, Reviewer])],
  controllers: [StudiesController],
  providers: [StudiesService],
})
export class StudiesModule {}
