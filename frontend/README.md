# Imaging Review Worklist Frontend

Next.js frontend for the Craft Crew imaging review assessment. It provides reviewer selection, study filters, ownership actions, study-scoped note drafts, and an interactive Cornerstone DICOM viewer.

## Prerequisites

- Node.js 24 or later
- pnpm 11 or later
- PostgreSQL
- The backend project in `../backend`
- Chromium for the Playwright browser tests

## Environment

Create the frontend environment file:

```bash
cp .env.example .env
```

The default development value is:

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```

Kubb uses this value when generating the client, so regenerate the API files after changing the backend URL.

## Prepare the backend

From the backend directory:

```bash
cd ../backend
cp .env.example .env
pnpm install
pnpm run migration:run
pnpm run seed
pnpm run start:dev
```

The backend runs at `http://localhost:3000`. Its Swagger UI is available at `http://localhost:3000/api/docs` and its OpenAPI document at `http://localhost:3000/api/openapi.json`.

To restore the exact seeded dataset after manual testing:

```bash
pnpm run db:reset
```

`db:reset` is destructive and should only be used for local development data.

## Install and generate the API client

With the backend running:

```bash
pnpm install
pnpm run api:generate
```

Generated TypeScript models, Fetch clients, and TanStack Query hooks are written to `src/api/generated`. Do not edit generated files manually.

To regenerate continuously while the OpenAPI document changes:

```bash
pnpm run api:watch
```

## Start the frontend

```bash
pnpm run dev
```

Open `http://localhost:3001`.

For a production build:

```bash
pnpm run build
pnpm run start
```

## Tests

Install the Playwright Chromium browser once:

```bash
pnpm exec playwright install chromium
```

Run the component tests:

```bash
pnpm run test:run
```

These tests cover out-of-order filters, study-scoped drafts, and stale completion recovery using controlled deferred responses.

Run the real-browser DICOM tests:

```bash
pnpm run test:e2e
```

Playwright starts or reuses the backend on port `3000` and frontend on port `3001`. The PostgreSQL database must already be migrated and seeded.

To watch the browser tests execute:

```bash
pnpm run test:e2e:headed
```

Run all static checks and the production build:

```bash
pnpm exec tsc --noEmit
pnpm run lint
pnpm run build
```

## Seeded DICOM fixtures

| Study | Fixture | Expected result |
| --- | --- | --- |
| `study-001` | `gradient.dcm` | Valid gradient image |
| `study-002` | `checkerboard.dcm` | Valid checkerboard image |
| `study-003` | `corrupt.dcm` | Visible decode error |

Additional seeded studies reuse these fixtures across `InReview` and `Completed` states.

## Viewer controls

- Drag on the image with the primary mouse button to adjust window/level.
- Use the Window width and Window center sliders for keyboard-accessible adjustment.
- Use **Fit / Reset** to restore the initial camera and window/level.
- Resize the viewer vertically using its resize handle.

The viewer displays only modality, study date, and image dimensions from DICOM metadata. It does not display or log raw patient-identifying tags. The application is for synthetic software testing and is not intended for diagnostic use.

## Manual concurrency check

1. Open the frontend in two browser windows.
2. Select Reviewer A in one window and Reviewer B in the other.
3. Open the same unassigned study in both windows.
4. Attempt to claim it from both windows.
5. Confirm one succeeds and the other receives a stale-version message.
6. Refresh both windows and confirm that the successful owner persists.
