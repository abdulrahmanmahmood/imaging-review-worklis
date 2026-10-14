import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1792003112798 implements MigrationInterface {
  name = 'InitialSchema1792003112798';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TYPE "public"."study_status" AS ENUM('Unassigned', 'InReview', 'Completed')
        `);
    await queryRunner.query(`
            CREATE TABLE "studies" (
                "id" character varying(64) NOT NULL,
                "modality" character varying(16) NOT NULL,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                "status" "public"."study_status" NOT NULL DEFAULT 'Unassigned',
                "ownerId" character varying(64),
                "reviewNote" text,
                "version" integer NOT NULL DEFAULT '1',
                "dicomFileKey" character varying(64) NOT NULL,
                CONSTRAINT "PK_b100ff0c4a0ad02a9c2270d45b6" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "idx_studies_worklist" ON "studies" ("status", "modality", "createdAt", "id")
        `);
    await queryRunner.query(`
            CREATE TABLE "reviewers" (
                "id" character varying(64) NOT NULL,
                "displayName" character varying(100) NOT NULL,
                CONSTRAINT "PK_79de995aea9d2f606dff4cfefcd" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            ALTER TABLE "studies"
            ADD CONSTRAINT "FK_195157c6f7fb2914af0e3112291" FOREIGN KEY ("ownerId") REFERENCES "reviewers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "studies" DROP CONSTRAINT "FK_195157c6f7fb2914af0e3112291"
        `);
    await queryRunner.query(`
            DROP TABLE "reviewers"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."idx_studies_worklist"
        `);
    await queryRunner.query(`
            DROP TABLE "studies"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."study_status"
        `);
  }
}
