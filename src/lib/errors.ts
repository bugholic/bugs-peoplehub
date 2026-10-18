export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = () => new ApiError(401, "UNAUTHORIZED", "Sign in required");
export const forbidden = (msg = "You don't have access to this") => new ApiError(403, "FORBIDDEN", msg);
export const notFound = (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found`);
export const badRequest = (msg: string, code = "BAD_REQUEST") => new ApiError(400, code, msg);
export const conflict = (msg: string, code = "CONFLICT") => new ApiError(409, code, msg);
