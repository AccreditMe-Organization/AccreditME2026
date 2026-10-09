import { GraphClient, GraphError, MAX_WAIT_MS } from './graph-client';

const TOKEN = 'eyJ.graph-token-never-in-an-error';

/** A fetch that answers from a script, recording what it was asked. */
function scripted(answers: Array<() => Response>) {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    seen.push({ url, init });
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    return next();
  };
  return { fetchFn, seen };
}
const status = (code: number, headers: Record<string, string> = {}, body: unknown = { error: { code: 'x' } }) => () =>
  new Response(JSON.stringify(body), { status: code, headers });

describe('GraphClient — Microsoft’s throttling guidance (ACC-185)', () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  beforeEach(() => {
    sleeps.length = 0;
  });

  it('sends the bearer token and returns the response once it is a success', async () => {
    const graph = scripted([status(200, {}, { id: 'x' })]);
    const json = await new GraphClient(graph.fetchFn, sleep).json<{ id: string }>({ method: 'GET', path: '/sites/a', token: TOKEN, purpose: 'site' });
    expect(json).toEqual({ id: 'x' });
    expect(graph.seen[0]!.url).toBe('https://graph.microsoft.com/v1.0/sites/a');
    expect((graph.seen[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('waits the Retry-After seconds a 429 names, then retries', async () => {
    const graph = scripted([status(429, { 'retry-after': '3' }), status(200)]);
    await new GraphClient(graph.fetchFn, sleep).send({ method: 'GET', path: '/x', token: TOKEN, purpose: 'site' });
    expect(sleeps).toEqual([3000]);
    expect(graph.seen).toHaveLength(2);
  });

  it('reads a Retry-After given as an HTTP date', async () => {
    const now = Date.parse('2026-10-08T10:00:00Z');
    const graph = scripted([status(503, { 'retry-after': 'Thu, 08 Oct 2026 10:00:05 GMT' }), status(200)]);
    await new GraphClient(graph.fetchFn, sleep, () => now).send({ method: 'GET', path: '/x', token: TOKEN, purpose: 'site' });
    expect(sleeps).toEqual([5000]);
  });

  it('backs off exponentially when no Retry-After is given, and treats 503 like 429', async () => {
    const graph = scripted([status(503), status(429), status(200)]);
    await new GraphClient(graph.fetchFn, sleep).send({ method: 'GET', path: '/x', token: TOKEN, purpose: 'site' });
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('gives up after three attempts, with the wait Microsoft asked for', async () => {
    const graph = scripted([status(429, { 'retry-after': '1' }), status(429, { 'retry-after': '1' }), status(429, { 'retry-after': '4' })]);
    const error = (await new GraphClient(graph.fetchFn, sleep)
      .send({ method: 'PUT', path: '/x', token: TOKEN, purpose: 'write' })
      .catch((e: unknown) => e)) as GraphError;
    expect(error).toBeInstanceOf(GraphError);
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(4);
    expect(graph.seen).toHaveLength(3);
  });

  it(`does not wait past ${MAX_WAIT_MS / 1000} seconds in total`, async () => {
    const graph = scripted([status(429, { 'retry-after': '30' })]);
    const error = (await new GraphClient(graph.fetchFn, sleep)
      .send({ method: 'GET', path: '/x', token: TOKEN, purpose: 'read' })
      .catch((e: unknown) => e)) as GraphError;
    expect(error.retryAfterSeconds).toBe(30);
    expect(sleeps).toEqual([]);
  });

  it('never retries any other error, and reports Graph’s code — never its message or the token', async () => {
    const graph = scripted([status(403, {}, { error: { code: 'accessDenied', message: 'details that must not leak' } })]);
    const error = (await new GraphClient(graph.fetchFn, sleep)
      .send({ method: 'GET', path: '/x', token: TOKEN, purpose: 'library' })
      .catch((e: unknown) => e)) as GraphError;
    expect(graph.seen).toHaveLength(1);
    expect(error.status).toBe(403);
    expect(error.code).toBe('accessDenied');
    expect(error.message).not.toContain('details that must not leak');
    expect(error.message).not.toContain(TOKEN);
  });

  it('turns a network failure into status 0, without the underlying message', async () => {
    const error = (await new GraphClient(async () => {
      throw new Error(`socket hang up, Authorization: Bearer ${TOKEN}`);
    }, sleep)
      .send({ method: 'GET', path: '/x', token: TOKEN, purpose: 'site' })
      .catch((e: unknown) => e)) as GraphError;
    expect(error.status).toBe(0);
    expect(error.message).not.toContain(TOKEN);
  });
});
