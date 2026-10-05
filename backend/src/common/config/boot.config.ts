import { resolveFrontendOrigin } from './cors.config';
import { AppLinkConfig, resolveAppLinkConfig } from './app-url.config';

/**
 * Everything the API must have before it starts, checked in one place — ACC-158.
 *
 * `main.ts` calls this FIRST, before `NestFactory.create()`: before the
 * database connects and before the in-process BullMQ workers register. A
 * missing required value therefore stops the process before it can serve a
 * request or consume a job, rather than after.
 *
 * It is a function rather than lines in `main.ts` so that the boot check is
 * proven by a spec (`boot.config.spec.ts`) instead of by reading the file. A
 * check that lives only in a bootstrap nobody runs under test is a promise, and
 * ACC-128 is the record of a comment in `main.ts` that made one the code did
 * not keep.
 *
 * Add a required value here, never as a lazy read at first use: a lazy read
 * fails on the first request that needs it — for an email link, inside a
 * BullMQ job, hours after a clean boot.
 */
export interface BootConfig {
  /** The one browser origin CORS allows (ACC-128). */
  frontendOrigin: string;
  /** Where emailed links point (ACC-158). */
  appLinks: AppLinkConfig;
}

export function validateBootConfig(
  env: NodeJS.ProcessEnv = process.env,
): BootConfig {
  return {
    frontendOrigin: resolveFrontendOrigin(env),
    appLinks: resolveAppLinkConfig(env),
  };
}
