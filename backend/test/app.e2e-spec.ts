import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { StudyStatus } from '../src/studies/enums/study-status.enum';

const TEST_IDS = [
  'e2e-concurrent-claim',
  'e2e-completion',
  'e2e-stale-completion',
  'e2e-invalid-note',
  'e2e-restart-persistence',
];

describe('Imaging worklist API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  async function createApplication(): Promise<INestApplication<App>> {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const application = moduleFixture.createNestApplication();
    configureApplication(application, { swagger: false });
    await application.init();
    return application;
  }

  async function removeTestStudies(): Promise<void> {
    await dataSource
      .createQueryBuilder()
      .delete()
      .from('studies')
      .where('id IN (:...ids)', { ids: TEST_IDS })
      .execute();
  }

  async function insertStudy(
    id: string,
    status: StudyStatus,
    ownerId: string | null = null,
    version = 1,
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO studies
        (id, modality, "createdAt", status, "ownerId", "reviewNote", version, "dicomFileKey")
       VALUES ($1, 'CT', NOW(), $2, $3, NULL, $4, 'gradient.dcm')`,
      [id, status, ownerId, version],
    );
  }

  beforeAll(async () => {
    app = await createApplication();
    dataSource = app.get(DataSource);
    await removeTestStudies();
  });

  afterEach(async () => {
    await removeTestStudies();
  });

  afterAll(async () => {
    await removeTestStudies();
    await app.close();
  });

  it('lists the two seeded reviewers for frontend selection', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/reviewers')
      .expect(200);

    expect(response.body).toEqual([
      { id: 'reviewer-a', displayName: 'Reviewer A' },
      { id: 'reviewer-b', displayName: 'Reviewer B' },
    ]);
  });

  it('allows one of two concurrent claims and returns stale state to the other', async () => {
    const id = 'e2e-concurrent-claim';
    await insertStudy(id, StudyStatus.Unassigned);

    const [reviewerA, reviewerB] = await Promise.all([
      request(app.getHttpServer()).post(`/api/studies/${id}/claim`).send({
        reviewerId: 'reviewer-a',
        expectedVersion: 1,
      }),
      request(app.getHttpServer()).post(`/api/studies/${id}/claim`).send({
        reviewerId: 'reviewer-b',
        expectedVersion: 1,
      }),
    ]);

    expect([reviewerA.status, reviewerB.status].sort()).toEqual([200, 412]);

    const success = reviewerA.status === 200 ? reviewerA : reviewerB;
    const stale = reviewerA.status === 412 ? reviewerA : reviewerB;
    expect(success.body).toMatchObject({
      id,
      status: StudyStatus.InReview,
      version: 2,
    });
    expect(stale.body).toMatchObject({
      code: 'STALE_VERSION',
      current: {
        id,
        status: StudyStatus.InReview,
        ownerId: success.body.ownerId,
        version: 2,
      },
    });
  });

  it('rejects a non-owner completion without changing any fields', async () => {
    const id = 'e2e-completion';
    await insertStudy(id, StudyStatus.InReview, 'reviewer-a');

    await request(app.getHttpServer())
      .post(`/api/studies/${id}/complete`)
      .send({
        reviewerId: 'reviewer-b',
        expectedVersion: 1,
        reviewNote: 'Must not persist.',
      })
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe('NOT_OWNER');
      });

    const current = await request(app.getHttpServer())
      .get(`/api/studies/${id}`)
      .expect(200);
    expect(current.body).toMatchObject({
      status: StudyStatus.InReview,
      ownerId: 'reviewer-a',
      reviewNote: null,
      version: 1,
    });
  });

  it('returns current state for a stale completion', async () => {
    const id = 'e2e-stale-completion';
    await insertStudy(id, StudyStatus.InReview, 'reviewer-a', 2);

    const response = await request(app.getHttpServer())
      .post(`/api/studies/${id}/complete`)
      .send({
        reviewerId: 'reviewer-a',
        expectedVersion: 1,
        reviewNote: 'Stale attempt.',
      })
      .expect(412);

    expect(response.body).toMatchObject({
      code: 'STALE_VERSION',
      current: {
        id,
        status: StudyStatus.InReview,
        ownerId: 'reviewer-a',
        reviewNote: null,
        version: 2,
      },
    });
  });

  it('rejects missing, blank and overlong notes without changing the study', async () => {
    const id = 'e2e-invalid-note';
    await insertStudy(id, StudyStatus.InReview, 'reviewer-a');

    const invalidNotes = [undefined, '   ', 'x'.repeat(1001)];
    for (const reviewNote of invalidNotes) {
      const payload: Record<string, unknown> = {
        reviewerId: 'reviewer-a',
        expectedVersion: 1,
      };
      if (reviewNote !== undefined) {
        payload.reviewNote = reviewNote;
      }

      await request(app.getHttpServer())
        .post(`/api/studies/${id}/complete`)
        .send(payload)
        .expect(400)
        .expect(({ body }) => {
          expect(body.code).toBe('INVALID_INPUT');
        });
    }

    const current = await request(app.getHttpServer())
      .get(`/api/studies/${id}`)
      .expect(200);
    expect(current.body).toMatchObject({
      status: StudyStatus.InReview,
      reviewNote: null,
      version: 1,
    });
  });

  it('persists a successful completion after the application restarts', async () => {
    const id = 'e2e-restart-persistence';
    await insertStudy(id, StudyStatus.InReview, 'reviewer-a');

    await request(app.getHttpServer())
      .post(`/api/studies/${id}/complete`)
      .send({
        reviewerId: 'reviewer-a',
        expectedVersion: 1,
        reviewNote: 'Persists across restart.',
      })
      .expect(200);

    await app.close();
    app = await createApplication();
    dataSource = app.get(DataSource);

    const current = await request(app.getHttpServer())
      .get(`/api/studies/${id}`)
      .expect(200);
    expect(current.body).toMatchObject({
      status: StudyStatus.Completed,
      ownerId: 'reviewer-a',
      reviewNote: 'Persists across restart.',
      version: 2,
    });
  });
});
