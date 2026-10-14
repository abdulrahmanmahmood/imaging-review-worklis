import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiErrorCode } from '../common/errors/api-error-code.enum';
import { ApiException } from '../common/errors/api.exception';
import { Reviewer } from '../reviewers/entities/reviewer.entity';
import { Study } from './entities/study.entity';
import { StudyStatus } from './enums/study-status.enum';
import { StudiesService } from './studies.service';

describe('StudiesService', () => {
  let service: StudiesService;
  let studiesRepository: jest.Mocked<
    Pick<Repository<Study>, 'find' | 'findOne'>
  >;
  let dataSource: { transaction: jest.Mock };

  const reviewer: Reviewer = {
    id: 'reviewer-a',
    displayName: 'Reviewer A',
    studies: [],
  };

  const study: Study = {
    id: 'study-001',
    modality: 'CT',
    createdAt: new Date('2026-01-01T08:00:00.000Z'),
    status: StudyStatus.InReview,
    ownerId: reviewer.id,
    owner: reviewer,
    reviewNote: null,
    version: 2,
    dicomFileKey: 'gradient.dcm',
  };

  beforeEach(async () => {
    studiesRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
    };
    dataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudiesService,
        {
          provide: getRepositoryToken(Study),
          useValue: studiesRepository,
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
      ],
    }).compile();

    service = module.get<StudiesService>(StudiesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('combines filters, orders results and limits the worklist to 100', async () => {
    studiesRepository.find.mockResolvedValue([study]);

    const result = await service.findAll({
      status: StudyStatus.InReview,
      modality: 'CT',
    });

    expect(studiesRepository.find).toHaveBeenCalledWith({
      where: { status: StudyStatus.InReview, modality: 'CT' },
      relations: { owner: true },
      order: { createdAt: 'ASC', id: 'ASC' },
      take: 100,
    });
    expect(result[0]).toEqual({
      id: study.id,
      modality: study.modality,
      createdAt: study.createdAt,
      status: study.status,
      ownerId: reviewer.id,
      owner: { id: reviewer.id, displayName: reviewer.displayName },
      reviewNote: null,
      version: 2,
    });
    expect(result[0]).not.toHaveProperty('dicomFileKey');
  });

  it('returns a safe public representation for a study', async () => {
    studiesRepository.findOne.mockResolvedValue(study);

    const result = await service.findOne(study.id);

    expect(result.id).toBe(study.id);
    expect(result.owner).toEqual({
      id: reviewer.id,
      displayName: reviewer.displayName,
    });
    expect(result).not.toHaveProperty('dicomFileKey');
  });

  it('returns STUDY_NOT_FOUND when the study does not exist', async () => {
    studiesRepository.findOne.mockResolvedValue(null);

    try {
      await service.findOne('missing');
      fail('Expected findOne to throw');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ApiException);

      const apiError = error as ApiException;
      expect(apiError.getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect(apiError.getResponse()).toEqual(
        expect.objectContaining({ code: ApiErrorCode.StudyNotFound }),
      );
    }
  });

  it('resolves a study file only through the fixed DICOM allowlist', async () => {
    studiesRepository.findOne.mockResolvedValue({
      ...study,
      dicomFileKey: 'gradient.dcm',
    });

    const file = await service.getFile(study.id);

    expect(studiesRepository.findOne).toHaveBeenCalledWith({
      select: { id: true, dicomFileKey: true },
      where: { id: study.id },
    });
    expect(file.filename).toBe('gradient.dcm');
    expect(file.path).toMatch(/assets\/dicom\/gradient\.dcm$/);
    expect(file.size).toBeGreaterThan(0);
  });

  it('rejects an unmapped file key without using it as a path', async () => {
    studiesRepository.findOne.mockResolvedValue({
      ...study,
      dicomFileKey: '../../sensitive-file',
    });

    await expect(service.getFile(study.id)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.StudyFileNotFound,
      }),
    });
  });

  it('claims an unassigned study and advances its version', async () => {
    const unassignedStudy: Study = {
      ...study,
      status: StudyStatus.Unassigned,
      ownerId: null,
      owner: null,
      version: 1,
    };
    const transactionalStudiesRepository = {
      findOne: jest.fn().mockResolvedValue(unassignedStudy),
      save: jest.fn().mockImplementation(async (entity: Study) => ({
        ...entity,
        version: entity.version + 1,
      })),
    };
    const transactionalReviewersRepository = {
      findOneBy: jest.fn().mockResolvedValue(reviewer),
    };
    const entityManager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === Reviewer
          ? transactionalReviewersRepository
          : transactionalStudiesRepository,
      ),
    };
    dataSource.transaction.mockImplementation(
      async (callback: (manager: typeof entityManager) => unknown) =>
        callback(entityManager),
    );

    const result = await service.claim(unassignedStudy.id, {
      reviewerId: reviewer.id,
      expectedVersion: 1,
    });

    expect(transactionalStudiesRepository.findOne).toHaveBeenCalledWith({
      where: { id: unassignedStudy.id },
      lock: { mode: 'pessimistic_write' },
    });
    expect(transactionalStudiesRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: StudyStatus.InReview,
        ownerId: reviewer.id,
      }),
    );
    expect(result.version).toBe(2);
    expect(result.ownerId).toBe(reviewer.id);
  });

  it('rejects an unknown reviewer before looking up the study', async () => {
    const transactionalStudiesRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    const transactionalReviewersRepository = {
      findOneBy: jest.fn().mockResolvedValue(null),
    };
    const entityManager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === Reviewer
          ? transactionalReviewersRepository
          : transactionalStudiesRepository,
      ),
    };
    dataSource.transaction.mockImplementation(
      async (callback: (manager: typeof entityManager) => unknown) =>
        callback(entityManager),
    );

    await expect(
      service.claim('study-001', {
        reviewerId: 'missing-reviewer',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.UnknownReviewer,
      }),
    });
    expect(transactionalStudiesRepository.findOne).not.toHaveBeenCalled();
  });

  it('returns the current study when the expected version is stale', async () => {
    const transactionalStudiesRepository = {
      findOne: jest.fn().mockResolvedValue(study),
      save: jest.fn(),
    };
    const transactionalReviewersRepository = {
      findOneBy: jest.fn().mockResolvedValue(reviewer),
    };
    const entityManager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === Reviewer
          ? transactionalReviewersRepository
          : transactionalStudiesRepository,
      ),
    };
    dataSource.transaction.mockImplementation(
      async (callback: (manager: typeof entityManager) => unknown) =>
        callback(entityManager),
    );

    try {
      await service.claim(study.id, {
        reviewerId: reviewer.id,
        expectedVersion: 1,
      });
      fail('Expected claim to throw');
    } catch (error: unknown) {
      const apiError = error as ApiException;
      expect(apiError.getStatus()).toBe(HttpStatus.PRECONDITION_FAILED);
      expect(apiError.getResponse()).toEqual(
        expect.objectContaining({
          code: ApiErrorCode.StaleVersion,
          current: expect.objectContaining({ id: study.id, version: 2 }),
        }),
      );
    }
    expect(transactionalStudiesRepository.save).not.toHaveBeenCalled();
  });

  it('completes an owned study, retains its owner and advances its version', async () => {
    const inReviewStudy: Study = { ...study, version: 3 };
    const transactionalStudiesRepository = {
      findOne: jest.fn().mockResolvedValue(inReviewStudy),
      save: jest.fn().mockImplementation(async (entity: Study) => ({
        ...entity,
        version: entity.version + 1,
      })),
    };
    const transactionalReviewersRepository = {
      findOneBy: jest.fn().mockResolvedValue(reviewer),
    };
    const entityManager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === Reviewer
          ? transactionalReviewersRepository
          : transactionalStudiesRepository,
      ),
    };
    dataSource.transaction.mockImplementation(
      async (callback: (manager: typeof entityManager) => unknown) =>
        callback(entityManager),
    );

    const result = await service.complete(inReviewStudy.id, {
      reviewerId: reviewer.id,
      expectedVersion: 3,
      reviewNote: 'Reviewed successfully.',
    });

    expect(transactionalStudiesRepository.findOne).toHaveBeenCalledWith({
      where: { id: inReviewStudy.id },
      lock: { mode: 'pessimistic_write' },
    });
    expect(transactionalStudiesRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: StudyStatus.Completed,
        ownerId: reviewer.id,
        reviewNote: 'Reviewed successfully.',
      }),
    );
    expect(result.version).toBe(4);
    expect(result.ownerId).toBe(reviewer.id);
    expect(result.reviewNote).toBe('Reviewed successfully.');
  });

  it('rejects completion by a reviewer who does not own the study', async () => {
    const otherReviewer: Reviewer = {
      id: 'reviewer-b',
      displayName: 'Reviewer B',
      studies: [],
    };
    const inReviewStudy: Study = { ...study };
    const transactionalStudiesRepository = {
      findOne: jest.fn().mockResolvedValue(inReviewStudy),
      save: jest.fn(),
    };
    const transactionalReviewersRepository = {
      findOneBy: jest.fn().mockResolvedValue(otherReviewer),
    };
    const entityManager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === Reviewer
          ? transactionalReviewersRepository
          : transactionalStudiesRepository,
      ),
    };
    dataSource.transaction.mockImplementation(
      async (callback: (manager: typeof entityManager) => unknown) =>
        callback(entityManager),
    );

    await expect(
      service.complete(inReviewStudy.id, {
        reviewerId: otherReviewer.id,
        expectedVersion: inReviewStudy.version,
        reviewNote: 'Must not be saved.',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: ApiErrorCode.NotOwner }),
    });
    expect(transactionalStudiesRepository.save).not.toHaveBeenCalled();
  });

  it('checks state before ownership during completion', async () => {
    const completedStudy: Study = {
      ...study,
      status: StudyStatus.Completed,
    };
    const otherReviewer: Reviewer = {
      id: 'reviewer-b',
      displayName: 'Reviewer B',
      studies: [],
    };
    const transactionalStudiesRepository = {
      findOne: jest.fn().mockResolvedValue(completedStudy),
      save: jest.fn(),
    };
    const transactionalReviewersRepository = {
      findOneBy: jest.fn().mockResolvedValue(otherReviewer),
    };
    const entityManager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === Reviewer
          ? transactionalReviewersRepository
          : transactionalStudiesRepository,
      ),
    };
    dataSource.transaction.mockImplementation(
      async (callback: (manager: typeof entityManager) => unknown) =>
        callback(entityManager),
    );

    await expect(
      service.complete(completedStudy.id, {
        reviewerId: otherReviewer.id,
        expectedVersion: completedStudy.version,
        reviewNote: 'Must not be saved.',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: ApiErrorCode.InvalidState }),
    });
    expect(transactionalStudiesRepository.save).not.toHaveBeenCalled();
  });
});
