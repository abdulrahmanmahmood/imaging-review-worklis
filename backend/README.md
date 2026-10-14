# Imaging Review Worklist API

NestJS, TypeORM, and PostgreSQL backend for a two-reviewer DICOM imaging worklist.

## Prerequisites

- Node.js 24 or later
- pnpm 11 or later
- PostgreSQL running locally
- A PostgreSQL role matching the credentials in `.env`

## Setup

```bash
cp .env.example .env
pnpm install
createdb -h localhost -U postgres craftcrew
pnpm run migration:run
pnpm run seed
```

Update `.env` if your PostgreSQL host, port, username, password, or database name differs. The seed command is idempotent and creates the two reviewers and sample studies required by the worklist.

## Start the API

```bash
pnpm run start:dev
```

For a production build:

```bash
pnpm run build
pnpm run start:prod
```

The API runs at `http://localhost:3000/api` by default.

- Swagger UI: `http://localhost:3000/api/docs`
- OpenAPI JSON: `http://localhost:3000/api/openapi.json`

The OpenAPI operations have stable operation IDs suitable for generating frontend clients with Kubb.

## Database commands

```bash
pnpm run migration:show
pnpm run migration:run
pnpm run migration:revert
pnpm run seed
pnpm run db:reset
```

`db:reset` reverts the latest migration, recreates the schema, and reseeds the database. It is destructive and should only be used for local development data.

TypeORM schema synchronization is disabled. Normal application startup never recreates or clears the database.

## Tests

```bash
pnpm test --runInBand
pnpm run test:e2e --runInBand
pnpm run smoke:contention
pnpm run test:cov
```

The e2e suite uses the configured PostgreSQL database and creates isolated temporary records that it removes after each test. It covers claim contention, authorization, stale versions, validation, and persistence across an application restart.

The contention smoke test starts two independent API processes and verifies that simultaneous claims produce exactly one success and one stale-version response.

## API endpoints

| Method | Endpoint                    | Purpose                                                                                       |
| ------ | --------------------------- | --------------------------------------------------------------------------------------------- |
| `GET`  | `/api/reviewers`            | List reviewers available to the frontend.                                                     |
| `GET`  | `/api/studies`              | List studies with optional `status`, `modality`, `reviewerId`, `limit`, and `offset` filters. |
| `GET`  | `/api/studies/:id`          | Get one study and its current assignment state.                                               |
| `GET`  | `/api/studies/:id/file`     | Stream the study's allowlisted DICOM file.                                                    |
| `POST` | `/api/studies/:id/claim`    | Atomically claim an unassigned study using `reviewerId` and `version`.                        |
| `POST` | `/api/studies/:id/complete` | Complete a claimed study using `reviewerId`, `version`, and non-empty `notes`.                |

Claim and completion mutations run inside database transactions with row-level locks and optimistic version checks. Conflicting updates return a structured `412 STALE_VERSION` response, and failed mutations leave the study unchanged.

DICOM downloads are resolved through a fixed server-side allowlist; client input is never interpreted as a filesystem path.
