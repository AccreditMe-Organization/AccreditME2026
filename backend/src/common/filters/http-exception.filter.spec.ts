// ACC-27 — proves the filter's three branches: HttpException subclasses
// pass through unchanged (the shape ACC-26's frontend extractErrorMessage()
// depends on), a real Better Auth APIError (class-identity check, matching
// AuthService's ACC-25 precedent) surfaces its own safe message, and any
// other unknown error is logged server-side and returns exactly one static
// generic message regardless of the underlying error.
import { ArgumentsHost, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

// Same rationale/pattern as auth.service.spec.ts: better-auth/api is
// ESM-only (.mjs) and breaks Jest's transform if loaded for real. This mock
// isAPIError recognizes only MockAPIError instances, letting these tests
// prove the filter's real control flow (recognized -> forward its own safe
// message; anything else -> generic fallback) without the real
// better-auth/api module ever loading. isAPIError's own correctness is a
// better-auth library invariant, verified separately by reading its actual
// source — not re-tested here.
class MockAPIError extends Error {
  constructor(public body: { message?: string; code?: string }) {
    super(body.message);
    this.name = 'MockAPIError';
  }
}
jest.mock('better-auth/api', () => ({
  isAPIError: (err: unknown) => err instanceof MockAPIError,
}));

function buildHost(): { host: ArgumentsHost; response: { status: jest.Mock; json: jest.Mock } } {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => consoleErrorSpy.mockRestore());

  it('passes a BadRequestException through with its own status and response shape unchanged', () => {
    const { host, response } = buildHost();
    const exception = new BadRequestException(['roleId must be a string']);

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(exception.getResponse());
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, message: ['roleId must be a string'] }),
    );
  });

  it('passes a NotFoundException through unchanged', () => {
    const { host, response } = buildHost();
    const exception = new NotFoundException('Role not found');

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith(exception.getResponse());
  });

  it('passes a ConflictException through unchanged', () => {
    const { host, response } = buildHost();
    const exception = new ConflictException('User is already assigned to this role');

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(exception.getResponse());
  });

  it("surfaces a recognized Better Auth APIError's own safe message (ACC-25 precedent)", () => {
    const { host, response } = buildHost();
    const exception = new MockAPIError({
      message: 'The password you entered has been compromised. Please choose a different password.',
    });

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 400,
      message: 'The password you entered has been compromised. Please choose a different password.',
      error: 'Bad Request',
    });
  });

  it('falls back to the generic message when a recognized APIError has no body message', () => {
    const { host, response } = buildHost();
    const exception = new MockAPIError({});

    filter.catch(exception, host);

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'An unexpected error occurred. Please try again or contact support.',
      }),
    );
  });

  it('logs and returns one static generic message for an unknown/unhandled error, never the real message', () => {
    const { host, response } = buildHost();
    const exception = new Error('a real internal secret detail that must never reach the client');

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'An unexpected error occurred. Please try again or contact support.',
      error: 'Internal Server Error',
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith('Unhandled exception:', exception);
  });

  it('returns the identical static message for a completely different unknown error type (no status-code variation)', () => {
    const { host, response } = buildHost();

    filter.catch('a thrown string, not even an Error instance', host);

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'An unexpected error occurred. Please try again or contact support.',
      }),
    );
  });
});
