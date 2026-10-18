export type LumoErrorCode =
  | "not_found"
  | "invalid_input"
  | "invalid_workflow"
  | "invalid_transition"
  | "jql_syntax"
  | "unauthorized"
  | "forbidden"
  | "conflict";

/** An expected, user-facing error. The server maps `code` to an HTTP status. */
export class LumoError extends Error {
  readonly code: LumoErrorCode;

  constructor(code: LumoErrorCode, message: string) {
    super(message);
    this.name = "LumoError";
    this.code = code;
  }
}
