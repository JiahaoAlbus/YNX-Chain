export class DeveloperError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DeveloperError";
    this.code = code;
    this.details = details;
  }
}

export function invariant(condition, code, message, details) {
  if (!condition) throw new DeveloperError(code, message, details);
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
