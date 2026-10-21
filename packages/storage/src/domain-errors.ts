/**
 * Typed domain errors so API layers map failures by class/code, never by message text.
 * (Infrastructure failures are StorageError / StorageBusyError in ./driver/errors.ts.)
 */
export class StorageNotFoundError extends Error {
  readonly code = "not_found" as const;

  constructor(message: string) {
    super(message);
    this.name = "StorageNotFoundError";
  }
}

export class StorageValidationError extends Error {
  readonly code = "invalid_request" as const;

  constructor(message: string) {
    super(message);
    this.name = "StorageValidationError";
  }
}
