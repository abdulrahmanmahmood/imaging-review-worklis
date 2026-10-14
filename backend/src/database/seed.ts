import dataSource from './data-source';
import { Reviewer } from '../reviewers/entities/reviewer.entity';
import { Study } from '../studies/entities/study.entity';
import { StudyStatus } from '../studies/enums/study-status.enum';

const reviewers: Array<Pick<Reviewer, 'id' | 'displayName'>> = [
  { id: 'reviewer-a', displayName: 'Reviewer A' },
  { id: 'reviewer-b', displayName: 'Reviewer B' },
];

const studies: Array<
  Pick<
    Study,
    | 'id'
    | 'modality'
    | 'createdAt'
    | 'status'
    | 'ownerId'
    | 'reviewNote'
    | 'version'
    | 'dicomFileKey'
  >
> = [
  {
    id: 'study-001',
    modality: 'CT',
    createdAt: new Date('2026-01-01T08:00:00.000Z'),
    status: StudyStatus.Unassigned,
    ownerId: null,
    reviewNote: null,
    version: 1,
    dicomFileKey: 'gradient.dcm',
  },
  {
    id: 'study-002',
    modality: 'MR',
    createdAt: new Date('2026-01-02T08:00:00.000Z'),
    status: StudyStatus.Unassigned,
    ownerId: null,
    reviewNote: null,
    version: 1,
    dicomFileKey: 'checkerboard.dcm',
  },
  {
    id: 'study-003',
    modality: 'CR',
    createdAt: new Date('2026-01-03T08:00:00.000Z'),
    status: StudyStatus.InReview,
    ownerId: 'reviewer-a',
    reviewNote: null,
    version: 1,
    dicomFileKey: 'corrupt.dcm',
  },
  {
    id: 'study-004',
    modality: 'CT',
    createdAt: new Date('2026-01-04T08:00:00.000Z'),
    status: StudyStatus.InReview,
    ownerId: 'reviewer-b',
    reviewNote: null,
    version: 1,
    dicomFileKey: 'gradient.dcm',
  },
  {
    id: 'study-005',
    modality: 'MR',
    createdAt: new Date('2026-01-05T08:00:00.000Z'),
    status: StudyStatus.Completed,
    ownerId: 'reviewer-a',
    reviewNote: 'Initial seeded review completed by Reviewer A.',
    version: 1,
    dicomFileKey: 'checkerboard.dcm',
  },
  {
    id: 'study-006',
    modality: 'CR',
    createdAt: new Date('2026-01-06T08:00:00.000Z'),
    status: StudyStatus.Completed,
    ownerId: 'reviewer-b',
    reviewNote: 'Initial seeded review completed by Reviewer B.',
    version: 1,
    dicomFileKey: 'corrupt.dcm',
  },
];

async function seed(): Promise<void> {
  await dataSource.initialize();

  try {
    await dataSource.transaction(async (entityManager) => {
      await entityManager
        .createQueryBuilder()
        .insert()
        .into(Reviewer)
        .values(reviewers)
        .orIgnore()
        .execute();

      await entityManager
        .createQueryBuilder()
        .insert()
        .into(Study)
        .values(studies)
        .orIgnore()
        .execute();
    });

    console.log('Seed completed without overwriting existing records.');
  } finally {
    await dataSource.destroy();
  }
}

void seed().catch((error: unknown) => {
  console.error('Seed failed.', error);
  process.exitCode = 1;
});
