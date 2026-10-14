import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { ApiErrorCode } from '../common/errors/api-error-code.enum';
import { ApiException } from '../common/errors/api.exception';
import { Reviewer } from '../reviewers/entities/reviewer.entity';
import { ClaimStudyDto } from './dto/claim-study.dto';
import { CompleteStudyDto } from './dto/complete-study.dto';
import { ListStudiesQueryDto } from './dto/list-studies-query.dto';
import { StudyResponseDto } from './dto/study-response.dto';
import { Study } from './entities/study.entity';
import { StudyStatus } from './enums/study-status.enum';

const DICOM_FILE_PATHS: Readonly<Record<string, string>> = {
  'gradient.dcm': join(__dirname, '..', 'assets', 'dicom', 'gradient.dcm'),
  'checkerboard.dcm': join(
    __dirname,
    '..',
    'assets',
    'dicom',
    'checkerboard.dcm',
  ),
  'corrupt.dcm': join(__dirname, '..', 'assets', 'dicom', 'corrupt.dcm'),
};

export interface StudyFile {
  path: string;
  filename: string;
  size: number;
}

@Injectable()
export class StudiesService {
  constructor(
    @InjectRepository(Study)
    private readonly studiesRepository: Repository<Study>,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(query: ListStudiesQueryDto): Promise<StudyResponseDto[]> {
    const where: FindOptionsWhere<Study> = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.modality) {
      where.modality = query.modality;
    }

    const studies = await this.studiesRepository.find({
      where,
      relations: { owner: true },
      order: { createdAt: 'ASC', id: 'ASC' },
      take: 100,
    });

    return studies.map((study) => StudyResponseDto.fromEntity(study));
  }

  async findOne(id: string): Promise<StudyResponseDto> {
    const study = await this.studiesRepository.findOne({
      where: { id },
      relations: { owner: true },
    });

    if (!study) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ApiErrorCode.StudyNotFound,
        'Study not found.',
      );
    }

    return StudyResponseDto.fromEntity(study);
  }

  async getFile(id: string): Promise<StudyFile> {
    const study = await this.studiesRepository.findOne({
      select: { id: true, dicomFileKey: true },
      where: { id },
    });

    if (!study) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ApiErrorCode.StudyNotFound,
        'Study not found.',
      );
    }

    const filePath = DICOM_FILE_PATHS[study.dicomFileKey];
    if (!filePath) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ApiErrorCode.StudyFileNotFound,
        'DICOM file not found.',
      );
    }

    try {
      const file = await stat(filePath);

      if (!file.isFile()) {
        throw new Error('Mapped DICOM asset is not a file.');
      }

      return {
        path: filePath,
        filename: study.dicomFileKey,
        size: file.size,
      };
    } catch {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ApiErrorCode.StudyFileNotFound,
        'DICOM file not found.',
      );
    }
  }

  async claim(id: string, input: ClaimStudyDto): Promise<StudyResponseDto> {
    return this.dataSource.transaction(async (entityManager) => {
      const reviewersRepository = entityManager.getRepository(Reviewer);
      const studiesRepository = entityManager.getRepository(Study);

      const reviewer = await reviewersRepository.findOneBy({
        id: input.reviewerId,
      });

      if (!reviewer) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ApiErrorCode.UnknownReviewer,
          'Reviewer does not exist.',
        );
      }

      const study = await studiesRepository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!study) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          ApiErrorCode.StudyNotFound,
          'Study not found.',
        );
      }

      if (study.version !== input.expectedVersion) {
        if (study.ownerId) {
          study.owner = await reviewersRepository.findOneBy({
            id: study.ownerId,
          });
        }

        throw new ApiException(
          HttpStatus.PRECONDITION_FAILED,
          ApiErrorCode.StaleVersion,
          'The study has changed. Refresh it before retrying.',
          { current: StudyResponseDto.fromEntity(study) },
        );
      }

      if (study.status !== StudyStatus.Unassigned) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ApiErrorCode.InvalidState,
          'Only an unassigned study can be claimed.',
        );
      }

      study.status = StudyStatus.InReview;
      study.ownerId = reviewer.id;
      study.owner = reviewer;

      const claimedStudy = await studiesRepository.save(study);
      return StudyResponseDto.fromEntity(claimedStudy);
    });
  }

  async complete(
    id: string,
    input: CompleteStudyDto,
  ): Promise<StudyResponseDto> {
    return this.dataSource.transaction(async (entityManager) => {
      const reviewersRepository = entityManager.getRepository(Reviewer);
      const studiesRepository = entityManager.getRepository(Study);

      const reviewer = await reviewersRepository.findOneBy({
        id: input.reviewerId,
      });

      if (!reviewer) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ApiErrorCode.UnknownReviewer,
          'Reviewer does not exist.',
        );
      }

      const study = await studiesRepository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!study) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          ApiErrorCode.StudyNotFound,
          'Study not found.',
        );
      }

      if (study.version !== input.expectedVersion) {
        if (study.ownerId) {
          study.owner = await reviewersRepository.findOneBy({
            id: study.ownerId,
          });
        }

        throw new ApiException(
          HttpStatus.PRECONDITION_FAILED,
          ApiErrorCode.StaleVersion,
          'The study has changed. Refresh it before retrying.',
          { current: StudyResponseDto.fromEntity(study) },
        );
      }

      if (study.status !== StudyStatus.InReview) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ApiErrorCode.InvalidState,
          'Only a study in review can be completed.',
        );
      }

      if (study.ownerId !== reviewer.id) {
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          ApiErrorCode.NotOwner,
          'Only the current owner can complete this study.',
        );
      }

      study.status = StudyStatus.Completed;
      study.reviewNote = input.reviewNote;
      study.owner = reviewer;

      const completedStudy = await studiesRepository.save(study);
      return StudyResponseDto.fromEntity(completedStudy);
    });
  }
}
