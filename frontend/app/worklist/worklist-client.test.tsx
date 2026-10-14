import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudyResponseDto } from '@/src/api/generated/types/StudyResponseDto';
import { WorklistClient } from './worklist-client';

vi.mock('next/dynamic', () => ({
  default: () => function ViewerStub() {
    return <div data-testid="dicom-viewer" />;
  },
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestUrl(input: string | URL | Request) {
  return new URL(input instanceof Request ? input.url : input.toString());
}

function study(
  id: string,
  overrides: Partial<StudyResponseDto> = {},
): StudyResponseDto {
  return {
    id,
    modality: 'CT',
    createdAt: '2026-01-01T08:00:00.000Z',
    status: 'Unassigned',
    ownerId: null,
    owner: null,
    reviewNote: null,
    version: 1,
    ...overrides,
  };
}

function renderWorklist() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }

  return render(<WorklistClient />, { wrapper: Wrapper });
}

const reviewers = [
  { id: 'reviewer-a', displayName: 'Reviewer A' },
  { id: 'reviewer-b', displayName: 'Reviewer B' },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorklistClient', () => {
  it('does not let a delayed old filter response replace the current list', async () => {
    const listRequests: Deferred<Response>[] = [];
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url.pathname === '/api/reviewers') {
        return Promise.resolve(jsonResponse(reviewers));
      }
      if (url.pathname === '/api/studies') {
        const request = deferred<Response>();
        listRequests.push(request);
        return request.promise;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderWorklist();

    await waitFor(() => expect(listRequests).toHaveLength(1));
    await user.selectOptions(screen.getByLabelText('Status'), 'Completed');
    await waitFor(() => expect(listRequests).toHaveLength(2));

    await act(async () => {
      listRequests[1].resolve(
        jsonResponse([study('current-completed', { status: 'Completed' })]),
      );
      await listRequests[1].promise;
    });
    expect(await screen.findByRole('button', { name: 'current-completed' })).toBeVisible();

    await act(async () => {
      listRequests[0].resolve(jsonResponse([study('old-unassigned')]));
      await listRequests[0].promise;
    });

    expect(screen.getByRole('button', { name: 'current-completed' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'old-unassigned' })).not.toBeInTheDocument();
  });

  it('keeps review-note drafts scoped to each study while switching', async () => {
    const studies = [
      study('study-a', {
        status: 'InReview',
        ownerId: 'reviewer-a',
        owner: reviewers[0],
      }),
      study('study-b', {
        status: 'InReview',
        ownerId: 'reviewer-a',
        owner: reviewers[0],
      }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input);
        if (url.pathname === '/api/reviewers') return Promise.resolve(jsonResponse(reviewers));
        if (url.pathname === '/api/studies') return Promise.resolve(jsonResponse(studies));
        const id = url.pathname.match(/^\/api\/studies\/([^/]+)$/)?.[1];
        if (id) return Promise.resolve(jsonResponse(studies.find((item) => item.id === id)));
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const user = userEvent.setup();
    renderWorklist();
    await screen.findByRole('option', { name: 'Reviewer A' });
    await user.selectOptions(screen.getByLabelText('Reviewer'), 'reviewer-a');

    await user.click(await screen.findByRole('button', { name: 'study-a' }));
    const noteA = await screen.findByRole('textbox', { name: 'Review Note' });
    await user.type(noteA, 'Draft for A');

    await user.click(screen.getByRole('button', { name: 'study-b' }));
    const noteB = await screen.findByRole('textbox', { name: 'Review Note' });
    await user.type(noteB, 'Draft for B');

    await user.click(screen.getByRole('button', { name: 'study-a' }));
    expect(await screen.findByRole('textbox', { name: 'Review Note' })).toHaveValue('Draft for A');

    await user.click(screen.getByRole('button', { name: 'study-b' }));
    expect(await screen.findByRole('textbox', { name: 'Review Note' })).toHaveValue('Draft for B');
  });

  it('preserves a draft and blocks stale completion until acknowledgment', async () => {
    const initial = study('study-stale', {
      status: 'InReview',
      ownerId: 'reviewer-a',
      owner: reviewers[0],
      version: 1,
    });
    const current = { ...initial, version: 2 };
    let detailRequests = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = requestUrl(input);
        const method = input instanceof Request ? input.method : init?.method ?? 'GET';
        if (url.pathname === '/api/reviewers') return jsonResponse(reviewers);
        if (url.pathname === '/api/studies') return jsonResponse([current]);
        if (url.pathname === '/api/studies/study-stale' && method === 'GET') {
          detailRequests += 1;
          return jsonResponse(detailRequests === 1 ? initial : current);
        }
        if (url.pathname === '/api/studies/study-stale/complete') {
          return jsonResponse(
            {
              statusCode: 412,
              code: 'STALE_VERSION',
              message: 'The study version is stale.',
              current,
            },
            412,
          );
        }
        throw new Error(`Unexpected request: ${method} ${url}`);
      }),
    );

    const user = userEvent.setup();
    renderWorklist();
    await screen.findByRole('option', { name: 'Reviewer A' });
    await user.selectOptions(screen.getByLabelText('Reviewer'), 'reviewer-a');
    await user.click(await screen.findByRole('button', { name: 'study-stale' }));

    const note = await screen.findByRole('textbox', { name: 'Review Note' });
    await user.type(note, 'Keep this draft');
    await user.click(screen.getByRole('button', { name: 'Complete Review' }));

    const staleAlert = await screen.findByRole('alert');
    expect(staleAlert).toHaveTextContent('This study changed while you were reviewing it');
    expect(screen.getByRole('textbox', { name: 'Review Note' })).toHaveValue('Keep this draft');
    expect(screen.getByRole('button', { name: 'Complete Review' })).toBeDisabled();
    expect(within(staleAlert).getByRole('button', { name: 'I reviewed the current state' })).toBeEnabled();

    await user.click(
      within(staleAlert).getByRole('button', { name: 'I reviewed the current state' }),
    );
    expect(screen.getByRole('button', { name: 'Complete Review' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Review Note' })).toHaveValue('Keep this draft');
    expect(detailRequests).toBe(2);
  });
});
