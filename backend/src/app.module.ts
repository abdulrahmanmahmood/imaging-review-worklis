import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import { validateEnvironment } from './config/env.validation';
import { typeOrmConfig } from './config/typeorm.config';
import { StudiesModule } from './studies/studies.module';
import { ReviewersModule } from './reviewers/reviewers.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [databaseConfig],
      validate: validateEnvironment,
    }),
    TypeOrmModule.forRootAsync(typeOrmConfig),
    ReviewersModule,
    StudiesModule,
  ],
})
export class AppModule {}
