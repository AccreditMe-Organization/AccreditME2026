import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { maxUploadBytes } from './storage-platform-env';
import { StorageRefusalException } from './storage-refusal';

// multer ships no types and @types/multer is not installed (a new dependency
// means a Linux-regenerated lockfile, CLAUDE.md ACC-20); this is the slice of
// its API used here.
interface MulterError extends Error {
  code: string;
}
type RequestHandler = (req: Request, res: Response, next: (error?: unknown) => void) => void;
interface MulterInstance {
  single(field: string): RequestHandler;
}
interface MulterFactory {
  (options: {
    storage: unknown;
    limits: { fileSize: number; files: number; fields: number };
    defParamCharset: string;
  }): MulterInstance;
  memoryStorage(): unknown;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const multer = require('multer') as MulterFactory;

/**
 * ACC-177 — reads ONE file, in the field `file`, into memory, up to the upload
 * cap. Used in place of Nest's FileInterceptor so that every refusal carries a
 * code the screen can put into words (FileInterceptor turns multer's errors
 * into an uncoded 413/400).
 *
 * Guards run before interceptors, so nothing is parsed for a caller the
 * session guard has already refused.
 *
 * `defParamCharset: 'utf8'`: multer otherwise decodes the file name as latin1,
 * which turns every Arabic file name into mojibake.
 */
@Injectable()
export class SingleFileUploadInterceptor implements NestInterceptor {
  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const cap = maxUploadBytes();

    const upload = multer({
      storage: multer.memoryStorage(),
      // One file and nothing else. (busboy's own `parts` limit counts the file
      // part against itself, so it is not used.)
      limits: { fileSize: cap, files: 1, fields: 0 },
      defParamCharset: 'utf8',
    }).single('file');

    await new Promise<void>((resolve, reject) => {
      upload(req, res, (error?: unknown) => {
        if (!error) return resolve();
        const code = (error as MulterError).code;
        if (code === 'LIMIT_FILE_SIZE') return reject(new StorageRefusalException('FILE_TOO_LARGE', { maxBytes: cap }));
        return reject(new BadRequestException('Send one file, in a form field named "file"'));
      });
    });
    return next.handle();
  }
}
