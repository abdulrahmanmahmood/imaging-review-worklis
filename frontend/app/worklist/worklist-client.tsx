'use client'

import { useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useQueryClient } from '@tanstack/react-query'
import {
  getStudyQueryKey,
  useListReviewers,
  useListStudies,
  useGetStudy,
  useClaimStudy,
  useCompleteStudy,
} from '@/src/api/generated/hooks'
import type { StudyResponseDto } from '@/src/api/generated/types/StudyResponseDto'
import type { ListStudiesQuery } from '@/src/api/generated/types/ListStudies'
import { ResponseError, client } from '@/src/api/generated/.kubb/client'

type ActionFeedback = {
  studyId: string
  message: string
  stale: boolean
}

function getActionErrorMessage(error: unknown, fallback: string) {
  if (ResponseError.is(error)) {
    const data = error.data as { message?: unknown }
    if (typeof data?.message === 'string') return data.message
  }
  return fallback
}

// Cornerstone needs WebGL, workers and the DOM, so it is never prerendered on the server.
const DicomViewer = dynamic(() => import('../viewer/dicom-viewer').then((m) => m.DicomViewer), {
  ssr: false,
  loading: () => <p className="text-sm text-zinc-500">Loading viewer…</p>,
})

export function WorklistClient() {
  const queryClient = useQueryClient()
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null)
  const [selectedReviewer, setSelectedReviewer] = useState('')
  const [filters, setFilters] = useState<ListStudiesQuery>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [staleBlocked, setStaleBlocked] = useState<Record<string, boolean>>({})
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null)

  const reviewers = useListReviewers()
  const studies = useListStudies({ query: { status: filters.status, modality: filters.modality || undefined } })
  const study = useGetStudy(
    { path: { id: selectedStudyId ?? '' } },
    { query: { enabled: !!selectedStudyId } },
  )
  const claim = useClaimStudy()
  const complete = useCompleteStudy()

  const synchronizeStudy = useCallback(
    async (updatedStudy: StudyResponseDto) => {
      queryClient.setQueryData(
        getStudyQueryKey({ path: { id: updatedStudy.id } }),
        updatedStudy,
      )
      await queryClient.invalidateQueries({
        predicate: (query) =>
          (query.queryKey[0] as { url?: string } | undefined)?.url === '/api/studies',
      })
    },
    [queryClient],
  )

  const handleClaim = useCallback(
    (s: StudyResponseDto) => {
      if (!selectedReviewer) return
      setActionFeedback(null)
      claim.mutate(
        { path: { id: s.id }, body: { reviewerId: selectedReviewer, expectedVersion: s.version } },
        {
          onSuccess: (updatedStudy) => {
            void synchronizeStudy(updatedStudy)
          },
          onError: (error) => {
            if (ResponseError.is(error) && error.status === 412) {
              setActionFeedback({
                studyId: s.id,
                message: 'The study changed before your claim was processed. Its current state is now shown.',
                stale: true,
              })
              void Promise.all([study.refetch(), studies.refetch()])
              return
            }
            setActionFeedback({
              studyId: s.id,
              message: getActionErrorMessage(error, 'The study could not be claimed. Check your connection and try again.'),
              stale: false,
            })
          },
        },
      )
    },
    [selectedReviewer, claim, studies, study, synchronizeStudy],
  )

  const handleComplete = useCallback(
    (studyId: string) => {
      const s = study.data
      if (!s || !selectedReviewer) return
      complete.mutate(
        {
          path: { id: studyId },
          body: { reviewerId: selectedReviewer, expectedVersion: s.version, reviewNote: drafts[studyId] ?? '' },
        },
        {
          onSuccess: (updatedStudy) => {
            setDrafts((prev) => {
              const next = { ...prev }
              delete next[studyId]
              return next
            })
            setStaleBlocked((prev) => ({ ...prev, [studyId]: false }))
            setActionFeedback(null)
            void synchronizeStudy(updatedStudy)
          },
          onError: (error) => {
            const stale = ResponseError.is(error) && error.status === 412
            if (stale) {
              setStaleBlocked((prev) => ({ ...prev, [studyId]: true }))
            }
            setActionFeedback({
              studyId,
              message: stale
                ? 'This study changed while you were reviewing it. Review the refreshed state and acknowledge it before submitting again.'
                : getActionErrorMessage(error, 'The review could not be completed. Your note is preserved; check your connection and try again.'),
              stale,
            })
            if (stale) {
              void Promise.all([study.refetch(), studies.refetch()])
            }
          },
        },
      )
    },
    [study, selectedReviewer, drafts, complete, studies, synchronizeStudy],
  )

  const handleSelectStudy = useCallback(
    (id: string) => {
      setSelectedStudyId((prev) => (prev === id ? null : id))
      setActionFeedback(null)
    },
    [],
  )

  const handleDraftChange = useCallback(
    (studyId: string, value: string) => {
      setDrafts((prev) => ({ ...prev, [studyId]: value }))
    },
    [],
  )

  const selectedStudy = study.data ?? null
  const loadingStudy = study.isPending
  const isOwner = !!(selectedReviewer && selectedStudy?.ownerId === selectedReviewer)
  const showComplete = selectedStudy?.status === 'InReview' && isOwner
  const currentDraft = selectedStudy ? drafts[selectedStudy.id] ?? '' : ''
  const trimmedDraftLength = currentDraft.trim().length
  const noteIsValid = trimmedDraftLength >= 1 && trimmedDraftLength <= 1000
  const currentFeedback =
    actionFeedback?.studyId === selectedStudyId ? actionFeedback : null

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      {/* reviewer + filters */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1 text-sm">
          <label className="flex flex-col gap-1 font-medium">
            Reviewer
            <select
              className="rounded border bg-white px-3 py-1.5 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={reviewers.isPending || reviewers.isError}
              value={selectedReviewer}
              onChange={(e) => setSelectedReviewer(e.target.value)}
            >
              <option value="">
                {reviewers.isPending
                  ? 'Loading reviewers…'
                  : reviewers.isError
                    ? 'Reviewers unavailable'
                    : '-- select --'}
              </option>
              {reviewers.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.displayName}
                </option>
              ))}
            </select>
          </label>
          {reviewers.isError && (
            <div className="flex items-center gap-2 text-xs text-red-600" role="alert">
              <span>Failed to load reviewers.</span>
              <button
                className="font-semibold underline underline-offset-2"
                onClick={() => void reviewers.refetch()}
                type="button"
              >
                Try again
              </button>
            </div>
          )}
        </div>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Status
          <select
            className="rounded border bg-white px-3 py-1.5 text-sm text-zinc-900"
            value={filters.status ?? ''}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: (e.target.value || undefined) as ListStudiesQuery['status'] }))}
          >
            <option value="">All</option>
            <option value="Unassigned">Unassigned</option>
            <option value="InReview">In Review</option>
            <option value="Completed">Completed</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Modality
          <select
            className="rounded border bg-white px-3 py-1.5 text-sm text-zinc-900"
            value={filters.modality ?? ''}
            onChange={(e) => setFilters((prev) => ({ ...prev, modality: e.target.value || undefined }))}
          >
            <option value="">All</option>
            <option value="CT">CT</option>
            <option value="MR">MR</option>
            <option value="CR">CR</option>
          </select>
        </label>

        <span className="ml-auto text-xs text-zinc-500">
          {selectedReviewer && (
            <span className="rounded bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">
              Reviewer: {reviewers.data?.find((r) => r.id === selectedReviewer)?.displayName ?? selectedReviewer}
            </span>
          )}
        </span>
      </div>

      {/* main area: worklist + detail */}
      <div className="flex flex-1 gap-4 overflow-hidden">
        {/* worklist table */}
        <div className="flex w-1/2 min-w-0 flex-col overflow-auto rounded border">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-800">
              <tr>
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Modality</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Owner</th>
              </tr>
            </thead>
            <tbody>
              {studies.isPending && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-zinc-500">
                    Loading…
                  </td>
                </tr>
              )}
              {studies.error && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-red-600">
                    Failed to load studies.
                  </td>
                </tr>
              )}
              {!studies.isPending && !studies.error && studies.data?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-zinc-500">
                    No studies found.
                  </td>
                </tr>
              )}
              {studies.data?.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-1.5">
                    <button
                      className={`w-full text-left ${selectedStudyId === s.id ? 'font-semibold text-blue-600' : ''}`}
                      onClick={() => handleSelectStudy(s.id)}
                    >
                      {s.id}
                    </button>
                  </td>
                  <td className="px-3 py-1.5">{s.modality}</td>
                  <td className="px-3 py-1.5">{s.status}</td>
                  <td className="px-3 py-1.5">{s.owner?.displayName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* detail panel */}
        <div className="flex w-1/2 min-w-0 flex-col gap-3 overflow-auto rounded border p-4">
          {!selectedStudyId && <p className="text-sm text-zinc-500">Select a study to view details.</p>}

          {selectedStudyId && loadingStudy && <p className="text-sm text-zinc-500">Loading study…</p>}

          {study.error && (
            <p className="text-sm text-red-600">Failed to load study details.</p>
          )}

          {selectedStudy && !loadingStudy && (
            <>
              <h2 className="text-lg font-semibold">{selectedStudy.id}</h2>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-zinc-500">Modality</span>
                <span>{selectedStudy.modality}</span>
                <span className="text-zinc-500">Status</span>
                <span>{selectedStudy.status}</span>
                <span className="text-zinc-500">Created</span>
                <span>{new Date(selectedStudy.createdAt).toLocaleString()}</span>
                <span className="text-zinc-500">Owner</span>
                <span>{selectedStudy.owner?.displayName ?? '—'}</span>
                <span className="text-zinc-500">Version</span>
                <span>{selectedStudy.version}</span>
              </div>

              <DicomViewer
                studyId={selectedStudy.id}
                apiBase={client.getConfig().baseURL ?? ''}
              />

              {selectedStudy.reviewNote && (
                <section
                  aria-label="Completed review note"
                  className="rounded border bg-zinc-50 p-3 text-sm dark:bg-zinc-900"
                >
                  <h3 className="font-semibold">Completed review note</h3>
                  <p className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                    {selectedStudy.reviewNote}
                  </p>
                </section>
              )}

              {currentFeedback && (
                <div
                  className={`rounded border p-3 text-sm ${currentFeedback.stale ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'}`}
                  role="alert"
                >
                  <p>{currentFeedback.message}</p>
                  {currentFeedback.stale && showComplete && (
                    <button
                      type="button"
                      className="mt-2 rounded border border-current px-3 py-1 font-medium"
                      onClick={() => {
                        setStaleBlocked((prev) => ({ ...prev, [selectedStudy.id]: false }))
                        setActionFeedback(null)
                      }}
                    >
                      I reviewed the current state
                    </button>
                  )}
                </div>
              )}

              {/* claim button */}
              {selectedStudy.status === 'Unassigned' && (
                <button
                  className="self-start rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                  disabled={!selectedReviewer || claim.isPending}
                  onClick={() => handleClaim(selectedStudy)}
                >
                  {claim.isPending ? 'Claiming…' : 'Claim Study'}
                </button>
              )}

              {/* completion form */}
              {showComplete && (
                <div className="mt-2 flex flex-col gap-2 border-t pt-3">
                  <label
                    className="text-sm font-medium"
                    htmlFor={`review-note-${selectedStudy.id}`}
                  >
                    Review Note
                  </label>
                  <textarea
                    className="min-h-[80px] rounded border p-2 text-sm"
                    id={`review-note-${selectedStudy.id}`}
                    placeholder="Enter review notes…"
                    maxLength={1000}
                    value={currentDraft}
                    onChange={(e) => handleDraftChange(selectedStudy.id, e.target.value)}
                  />
                  <div className="flex justify-between gap-3 text-xs">
                    <span className={currentDraft.length > 0 && !noteIsValid ? 'text-red-600' : 'text-zinc-500'}>
                      {currentDraft.length > 0 && trimmedDraftLength === 0
                        ? 'The note must contain non-space characters.'
                        : 'Required, 1–1,000 characters.'}
                    </span>
                    <span className="text-zinc-500">{currentDraft.length}/1000</span>
                  </div>
                  <button
                    className="self-start rounded bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50"
                    disabled={
                      complete.isPending ||
                      !noteIsValid ||
                      staleBlocked[selectedStudy.id]
                    }
                    onClick={() => handleComplete(selectedStudy.id)}
                  >
                    {complete.isPending ? 'Submitting…' : 'Complete Review'}
                  </button>
                  {staleBlocked[selectedStudy.id] && (
                    <p className="text-xs text-amber-600">
                      Review and acknowledge the refreshed study state before resubmitting.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
