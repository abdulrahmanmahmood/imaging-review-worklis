export enum ApiErrorCode {
  InvalidInput = 'INVALID_INPUT',
  UnknownReviewer = 'UNKNOWN_REVIEWER',
  StudyNotFound = 'STUDY_NOT_FOUND',
  StudyFileNotFound = 'STUDY_FILE_NOT_FOUND',
  StaleVersion = 'STALE_VERSION',
  InvalidState = 'INVALID_STATE',
  NotOwner = 'NOT_OWNER',
  RouteNotFound = 'ROUTE_NOT_FOUND',
  InternalError = 'INTERNAL_ERROR',
}
