import { TrackerError } from "./types.ts";

export interface HttpOptions {
  baseUrl: string;
  authorization: string;
  /** Pulls a readable message out of an error body. */
  errorMessage(body: unknown): string | undefined;
  fetch?: typeof fetch;
}

export function httpClient(opts: HttpOptions) {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const doFetch = opts.fetch ?? fetch;

  return async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(base + path, {
        method,
        headers: {
          authorization: opts.authorization,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new TrackerError(0, `Could not reach ${base}: ${(err as Error).message}`);
    }
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      const message = opts.errorMessage(parsed) ?? (typeof parsed === "string" && parsed ? parsed : res.statusText);
      throw new TrackerError(res.status, `${res.status}: ${message}`);
    }
    return parsed as T;
  };
}

export type Request = ReturnType<typeof httpClient>;
