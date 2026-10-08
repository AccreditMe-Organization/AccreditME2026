import { FetchFn } from './microsoft-identity';

// ACC-185 — the few Microsoft Graph calls SharePoint storage makes, with
// Microsoft's throttling guidance applied
// (https://learn.microsoft.com/en-us/graph/throttling): on 429 or 503, wait
// the Retry-After the response names (seconds or an HTTP date), with
// exponential backoff when it names none — at most 3 attempts and 20 seconds
// of waiting in total, because a person is usually waiting on the other end.
// Nothing else is retried.
//
// A GraphError carries the status and Graph's own error code. Never the
// Authorization header, never the token, never the response body's message.

const GRAPH = 'https://graph.microsoft.com/v1.0';
export const MAX_ATTEMPTS = 3;
export const MAX_WAIT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 30_000;

export class GraphError extends Error {
  constructor(
    readonly status: number,
    /** Graph's error.code, e.g. "accessDenied", "itemNotFound". */
    readonly code: string | null,
    /** What the call was for — a step name, safe to log. */
    readonly purpose: string,
    /** Set when throttling outlasted the retry budget. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`Microsoft Graph ${purpose} answered ${status}${code ? ` ${code}` : ''}`);
    this.name = 'GraphError';
  }
}

export interface GraphRequest {
  method: 'GET' | 'PUT' | 'DELETE';
  /** Path after /v1.0, already URL-encoded where needed. */
  path: string;
  token: string;
  purpose: string;
  body?: Buffer;
  contentType?: string;
}

export class GraphClient {
  constructor(
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The response, once it is a success. Anything else throws GraphError. */
  async send(request: GraphRequest): Promise<Response> {
    let waited = 0;
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchFn(`${GRAPH}${request.path}`, {
          method: request.method,
          headers: {
            authorization: `Bearer ${request.token}`,
            ...(request.contentType ? { 'content-type': request.contentType } : {}),
          },
          // fetch's BodyInit wants a plain Uint8Array; one copy, at most 25 MB.
          ...(request.body ? { body: Uint8Array.from(request.body) } : {}),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new GraphError(0, null, request.purpose);
      }
      if (response.ok) return response;

      const throttled = response.status === 429 || response.status === 503;
      if (!throttled) throw new GraphError(response.status, await errorCode(response), request.purpose);

      const delay = this.retryDelayMs(response.headers.get('retry-after'), attempt);
      if (attempt >= MAX_ATTEMPTS || waited + delay > MAX_WAIT_MS) {
        throw new GraphError(response.status, await errorCode(response), request.purpose, Math.ceil(delay / 1000));
      }
      await response.body?.cancel().catch(() => undefined);
      waited += delay;
      await this.sleep(delay);
    }
  }

  async json<T>(request: GraphRequest): Promise<T> {
    const response = await this.send(request);
    return (await response.json()) as T;
  }

  /** Retry-After in seconds or as an HTTP date; exponential backoff without one. */
  private retryDelayMs(header: string | null, attempt: number): number {
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
      const date = Date.parse(header);
      if (!Number.isNaN(date)) return Math.max(0, date - this.now());
    }
    return 2 ** (attempt - 1) * 1000;
  }
}

async function errorCode(response: Response): Promise<string | null> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null;
  return typeof body?.error?.code === 'string' ? body.error.code : null;
}
