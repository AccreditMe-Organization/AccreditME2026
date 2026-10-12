import { AnthropicAiProvider } from './anthropic-ai.provider';
import { AiProviderCallError } from './ai.provider';

describe('AnthropicAiProvider (ACC-194)', () => {
  const realFetch = global.fetch;
  const realKey = process.env['ANTHROPIC_API_KEY'];
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key-not-real';
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = realFetch;
    if (realKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = realKey;
  });

  const ok = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });
  const request = { model: 'claude-sonnet-5-5', prompt: 'Hello', system: 'Be brief', maxTokens: 2000, effort: 'low' as const };

  it('sends effort in output_config, and never thinking or temperature (5.x rules)', async () => {
    fetchMock.mockResolvedValue(ok({ model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Hi' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 2 } }));
    await new AnthropicAiProvider().complete(request);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: 'Hello' }],
      output_config: { effort: 'low' },
      system: 'Be brief',
    });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('thinking');
  });

  it('joins the text blocks and skips thinking blocks; reports usage and truncation', async () => {
    fetchMock.mockResolvedValue(
      ok({
        model: 'claude-sonnet-5-5',
        content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Part one. ' }, { type: 'text', text: 'Part two.' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 2000 },
      }),
    );
    expect(await new AnthropicAiProvider().complete(request)).toEqual({
      content: 'Part one. Part two.',
      model: 'claude-sonnet-5-5',
      inputTokens: 10,
      outputTokens: 2000,
      truncated: true,
    });
  });

  it('only the platform key is used, and with none it is not configured and sends nothing', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    const provider = new AnthropicAiProvider();
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.complete(request)).rejects.toEqual(new AiProviderCallError(null, 'not_configured'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an HTTP error carries the status and the error TYPE only, never the body text', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 529,
      json: () => Promise.resolve({ type: 'error', error: { type: 'overloaded_error', message: 'echo of SECRET-PROMPT' } }),
    });
    const error = (await new AnthropicAiProvider().complete(request).catch((e: unknown) => e)) as AiProviderCallError;
    expect(error).toBeInstanceOf(AiProviderCallError);
    expect(error.status).toBe(529);
    expect(error.kind).toBe('overloaded_error');
    expect(error.message).not.toContain('SECRET-PROMPT');
  });

  it('a refusal stop reason is a failed call (refunded by the gateway)', async () => {
    fetchMock.mockResolvedValue(ok({ model: 'm', content: [], stop_reason: 'refusal', usage: { input_tokens: 1, output_tokens: 0 } }));
    await expect(new AnthropicAiProvider().complete(request)).rejects.toEqual(new AiProviderCallError(200, 'refusal'));
  });

  it('a network failure and a timeout are failed calls', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'TimeoutError' }));
    await expect(new AnthropicAiProvider().complete(request)).rejects.toEqual(new AiProviderCallError(null, 'timeout'));
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(new AnthropicAiProvider().complete(request)).rejects.toEqual(new AiProviderCallError(null, 'network'));
  });
});
