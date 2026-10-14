import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';
import databaseConfig from './database.config';

export const typeOrmConfig: TypeOrmModuleAsyncOptions = {
  imports: [ConfigModule.forFeature(databaseConfig)],
  inject: [databaseConfig.KEY],
  useFactory: (database: ConfigType<typeof databaseConfig>) => ({
    type: database.type,
    host: database.host,
    port: database.port,
    username: database.username,
    password: database.password,
    database: database.name,
    autoLoadEntities: true,
    synchronize: false,
  }),
};
