import { pluginFetch } from '@kubb/plugin-fetch';
import { pluginReactQuery } from '@kubb/plugin-react-query';
import { pluginTs } from '@kubb/plugin-ts';
import { defineConfig } from 'kubb/config';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export default defineConfig({
  name: 'craftCrewApi',
  input: `${apiBaseUrl}/api/openapi.json`,
  output: {
    path: './src/api/generated',
    clean: true,
  },
  plugins: [
    pluginTs(),
    pluginFetch({
      baseURL: apiBaseUrl,
      throwOnErrorDefault: true,
    }),
    pluginReactQuery({
      client: 'fetch',
      hooks: true,
    }),
  ],
});
