/**
 * ACC-216 — the browser and operating system of a sign-in, read on the SERVER
 * from the User-Agent header its refresh row stored (`RefreshToken.deviceInfo`).
 *
 * The raw header is never sent to a screen: it is long, it carries version
 * numbers that fingerprint a device, and a screen needs only "Chrome on
 * Windows". No user-agent library is installed in either package, so this is a
 * small in-house reader (file-content.ts is the precedent): family names only,
 * no versions. Anything it does not recognise is null, which the screen words
 * as "Unknown browser" / "Unknown system".
 *
 * Order matters: Edge, Opera and Samsung Internet all also say "Chrome", and
 * Chrome on iOS says "Safari"; the more specific token is checked first.
 */
export interface SessionDevice {
  browser: string | null;
  os: string | null;
}

const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

export function sessionDevice(userAgent: string | null | undefined): SessionDevice {
  if (!userAgent) return { browser: null, os: null };
  const find = (table: ReadonlyArray<[RegExp, string]>) => table.find(([re]) => re.test(userAgent))?.[1] ?? null;
  return { browser: find(BROWSERS), os: find(SYSTEMS) };
}
