import type { IncomingMessage, ServerResponse } from "node:http";
import { LumoError, type User } from "@lumo/core";

export interface RequestContext {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  /** Origin the client used to reach the server, for building `self` links. */
  baseUrl: string;
  /** Null only on routes registered with `{ public: true }`. */
  user: User | null;
}

const REPLY = Symbol("reply");

export interface Reply {
  [REPLY]: true;
  status: number;
  body?: unknown;
}

/** Returns a response with a non-200 status. Handlers can also return a plain value for a 200. */
export function reply(status: number, body?: unknown): Reply {
  return { [REPLY]: true, status, body };
}

export type Handler = (ctx: RequestContext) => Reply | unknown;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  public: boolean;
}

/** Shapes an error response; the Jira-compatible API uses Jira's error format. */
export type ErrorFormatter = (status: number, message: string) => unknown;

const STATUS_BY_CODE: Record<LumoError["code"], number> = {
  not_found: 404,
  invalid_input: 400,
  invalid_workflow: 400,
  invalid_transition: 400,
  jql_syntax: 400,
  unauthorized: 401,
  forbidden: 403,
  conflict: 409,
};

const MAX_BODY_BYTES = 1024 * 1024;

export class Router {
  private readonly routes: Route[] = [];
  private readonly prefix: string;
  readonly formatError: ErrorFormatter;

  constructor(prefix: string, formatError: ErrorFormatter = (_status, message) => ({ error: message })) {
    this.prefix = prefix;
    this.formatError = formatError;
  }

  get(path: string, handler: Handler, opts?: { public?: boolean }) {
    this.add("GET", path, handler, opts);
  }
  post(path: string, handler: Handler) {
    this.add("POST", path, handler);
  }
  put(path: string, handler: Handler) {
    this.add("PUT", path, handler);
  }
  patch(path: string, handler: Handler) {
    this.add("PATCH", path, handler);
  }
  delete(path: string, handler: Handler) {
    this.add("DELETE", path, handler);
  }

  private add(method: string, path: string, handler: Handler, opts?: { public?: boolean }) {
    const keys: string[] = [];
    const source = (this.prefix + path).replace(/:(\w+)/g, (_m, key: string) => {
      keys.push(key);
      return "([^/]+)";
    });
    this.routes.push({ method, pattern: new RegExp(`^${source}/?$`), keys, handler, public: opts?.public ?? false });
  }

  handles(pathname: string): boolean {
    return pathname === this.prefix || pathname.startsWith(this.prefix + "/");
  }

  /** Returns false if no route matched the path at all. */
  async dispatch(req: IncomingMessage, res: ServerResponse, url: URL, authenticate: () => User | null): Promise<void> {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.pattern.exec(url.pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== req.method) continue;
      try {
        const user = authenticate();
        if (!user && !route.public) throw new LumoError("unauthorized", "Authentication required");
        const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
        const body = req.method === "GET" || req.method === "DELETE" ? undefined : await readJson(req);
        const result = await route.handler({ params, query: url.searchParams, body, user, baseUrl: baseUrlOf(req) });
        if (isReply(result)) send(res, result.status, result.body);
        else send(res, 200, result);
      } catch (err) {
        if (err instanceof LumoError) {
          send(res, STATUS_BY_CODE[err.code], this.formatError(STATUS_BY_CODE[err.code], err.message));
        } else {
          console.error(err);
          send(res, 500, this.formatError(500, "Internal server error"));
        }
      }
      return;
    }
    const status = pathMatched ? 405 : 404;
    send(res, status, this.formatError(status, pathMatched ? "Method not allowed" : "Not found"));
  }
}

function baseUrlOf(req: IncomingMessage): string {
  const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0]!.trim();
  return `${proto}://${req.headers.host ?? "localhost"}`;
}

function isReply(value: unknown): value is Reply {
  return typeof value === "object" && value !== null && REPLY in value;
}

export function send(res: ServerResponse, status: number, body: unknown): void {
  if (body === undefined || status === 204) {
    res.writeHead(status === 200 && body === undefined ? 204 : status).end();
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(json) });
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new LumoError("invalid_input", "Request body is too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new LumoError("invalid_input", "Request body must be valid JSON");
  }
}

/** Small helpers for reading untyped JSON bodies. */
export function obj(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LumoError("invalid_input", "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export function optString(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new LumoError("invalid_input", `"${key}" must be a string`);
  return v;
}

export function optNullableString(o: Record<string, unknown>, key: string): string | null | undefined {
  return o[key] === null ? null : optString(o, key);
}

export function optStringArray(o: Record<string, unknown>, key: string): string[] | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
    throw new LumoError("invalid_input", `"${key}" must be an array of strings`);
  }
  return v as string[];
}

export function intParam(query: URLSearchParams, key: string, fallback: number): number {
  const raw = query.get(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new LumoError("invalid_input", `"${key}" must be a non-negative integer`);
  return n;
}
