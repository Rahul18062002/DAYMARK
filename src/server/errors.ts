export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = (msg = "Please sign in to continue.") => new AppError(401, "UNAUTHENTICATED", msg);
export const forbidden = (msg = "You don't have permission to do that.") => new AppError(403, "FORBIDDEN", msg);
// Cross-organization and out-of-scope lookups deliberately look like "not found"
// so the API never confirms that a record exists somewhere else.
export const notFound = (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found.`);
export const conflict = (msg: string, code = "CONFLICT") => new AppError(409, code, msg);
export const badRequest = (msg: string, details?: unknown) => new AppError(400, "BAD_REQUEST", msg, details);
export const tooMany = (msg = "Too many requests. Please try again later.") => new AppError(429, "RATE_LIMITED", msg);
