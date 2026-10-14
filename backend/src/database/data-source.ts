import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Reviewer } from '../reviewers/entities/reviewer.entity';
import { Study } from '../studies/entities/study.entity';

const databasePort = Number(process.env.DATABASE_PORT ?? 5432);

if (!Number.isInteger(databasePort)) {
  throw new Error('DATABASE_PORT must be an integer');
}

export default new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST,
  port: databasePort,
  username: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  entities: [Reviewer, Study],
  migrations: [__dirname + '/migrations/*{.js,.ts}'],
  migrationsTableName: 'migrations',
  synchronize: false,
});
