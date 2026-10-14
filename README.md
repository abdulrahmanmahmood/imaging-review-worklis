# Imaging Review Worklist

A production-oriented full-stack assessment that coordinates two reviewers across a concurrent DICOM imaging worklist. The project focuses on the difficult parts of collaborative review software: database-backed ownership, stale-write recovery, deterministic async UI behavior, and safe lifecycle management for a browser DICOM renderer.

## Architecture

```text
Browser (Next.js + TanStack Query + Cornerstone)
                    │
                    │ typed REST client generated from OpenAPI
                    ▼
       NestJS API + TypeORM transactions
                    │
                    │ row locks + version checks
                    ▼
                PostgreSQL
```

The repository is organized as a monorepo:

```text
.
├── backend/              NestJS API, migrations, seed data and API tests
├── frontend/             Next.js UI, generated client and browser tests
├── compose.yaml          Complete production-like local stack
└── .github/workflows/    Full CI verification
```

## Key engineering decisions

### Database-enforced concurrency

Claim and completion operations use PostgreSQL transactions, pessimistic row locks, and optimistic version tokens. Two API processes can safely compete for the same study: exactly one claim succeeds and the other receives `412 STALE_VERSION` with the current record. Correctness does not depend on an in-process mutex.

### OpenAPI as the frontend/backend contract

NestJS Swagger decorators produce the canonical OpenAPI document at `/api/openapi.json`. The frontend uses **Kubb** to transform that contract into:

- TypeScript request and response models
- Native Fetch client functions
- TanStack Query keys, options and React hooks

This is intentionally preferred over handwritten queries. A manually maintained `fetch('/api/studies')` layer duplicates endpoint paths, payload shapes, error unions, and cache keys. Those copies silently drift when a DTO or endpoint changes. With Kubb, the backend contract is the source of truth: regenerate once, let TypeScript identify every affected caller, and use consistent query keys and mutation types everywhere.

Generated code lives in `frontend/src/api/generated` and must not be edited manually.

### Real DICOM rendering and lifecycle safety

Cornerstone renders the supplied DICOM pixels directly. The viewer supports window/level, Fit/Reset, responsive resizing, corrupt-file recovery, and cancellation guards that prevent old loads from attaching to a new or disposed viewport. Observable lifecycle counters verify that engines, tool groups, observers, and event listeners return to zero.

## Quick start with Docker

Requirements: Docker Engine with Docker Compose.

```bash
cp .env.example .env
docker compose up --build
```

Open:

- Frontend: <http://localhost:3001>
- API: <http://localhost:3000/api>
- Swagger UI: <http://localhost:3000/api/docs>
- OpenAPI JSON: <http://localhost:3000/api/openapi.json>

The API container waits for PostgreSQL, applies migrations, runs the idempotent seed, and then starts. PostgreSQL data is stored in the `postgres_data` named volume and survives ordinary restarts.

Stop the stack without deleting data:

```bash
docker compose down
```

Reset all containerized database data:

```bash
docker compose down --volumes
docker compose up --build
```

## Local development

Requirements: Node.js 24+, pnpm 11+, and PostgreSQL.

### Backend

```bash
cd backend
cp .env.example .env
pnpm install
pnpm run migration:run
pnpm run seed
pnpm run start:dev
```

### Frontend

With the API running:

```bash
cd frontend
cp .env.example .env
pnpm install
pnpm run api:generate
pnpm run dev
```

The frontend runs on port `3001`; the backend runs on port `3000`.

## Test strategy

### Backend verification

```bash
cd backend
pnpm exec tsc --noEmit
pnpm run lint
pnpm test --runInBand
pnpm run test:e2e --runInBand
pnpm run smoke:contention
pnpm run build
```

The real-database suite covers concurrent claims, owner/non-owner completion, stale versions, invalid notes, and restart persistence. The smoke test starts two independent API processes on separate ports.

### Frontend verification

```bash
cd frontend
pnpm exec playwright install chromium
pnpm exec tsc --noEmit
pnpm run lint
pnpm run test:run
pnpm run test:e2e
pnpm run build
```

Vitest uses controlled deferred responses for filter races, study-scoped drafts, and stale completion recovery. Playwright exercises the real Cornerstone canvas, both valid fixtures, corrupt-file recovery, window/level, resizing, delayed loads, disposal, and five close/reopen cycles.

## Seeded fixtures

| Study | Fixture | Initial state | Expected viewer result |
| --- | --- | --- | --- |
| `study-001` | `gradient.dcm` | Unassigned | Gradient image |
| `study-002` | `checkerboard.dcm` | Unassigned | Checkerboard image |
| `study-003` | `corrupt.dcm` | In review | Visible decode error |
| `study-004` | `gradient.dcm` | In review | Gradient image |
| `study-005` | `checkerboard.dcm` | Completed | Checkerboard image |
| `study-006` | `corrupt.dcm` | Completed | Visible decode error |

## Security and scope

- Study IDs map through a fixed server-side DICOM allowlist; callers never provide filesystem paths.
- The viewer exposes only modality, study date, and image dimensions from DICOM metadata.
- Raw patient-identifying tags are neither displayed nor logged.
- The fixtures are synthetic and the application is not intended for diagnostic use.

See [backend/README.md](backend/README.md) and [frontend/README.md](frontend/README.md) for project-specific commands and implementation details.
