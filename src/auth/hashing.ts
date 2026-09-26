import { createHash } from 'crypto';
import { parseCookies } from './cookies';
import { getFirstPartyAuthTokenWithTimestamp, UserIdentifier } from './tokencrafter';

export function generateSapisidHash(sapisid: string, origin: string, timestamp?: number): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  return generateSapisidHashWithTimestamp(sapisid, origin, ts);
}

export function generateSapisidHashWithTimestamp(
  sapisid: string,
  origin: string,
  timestamp: number,
): string {
  const payload = `${timestamp} ${sapisid} ${origin}`;
  const hash = createHash('sha1').update(payload).digest('hex');
  return `${timestamp}_${hash}`;
}

export interface SapisidAuthCookies {
  SAPISID?: string;
  SAPISID1P?: string;
  SAPISID3P?: string;
  '__Secure-1PSAPISID'?: string;
  '__Secure-3PSAPISID'?: string;
  [key: string]: string | undefined;
}

export interface SapisidAuthHeaderOptions {
  /** Unix seconds. Defaults to now. Pass one value so all 3 hashes share a timestamp. */
  timestamp?: number;
  /**
   * When the 1P/3P cookies are absent, reuse SAPISID so the header still
   * contains all three schemes with identical hashes (like browser snapshots
   * where all three values match). Defaults to true.
   */
  fallbackToSapisid?: boolean;
  /**
   * FPA v2 user identifiers embedded in the hash (e/u/a). Pass [] for the
   * classic `timestamp_hash` token with no suffix, or e.g.
   * `[{key:'e',value:email},{key:'u',value:obfuscatedGaiaId}]` for a
   * `timestamp_hash_eu` token as required by APIs like drivefrontend-pa.
   * Array (even empty) selects v2; null selects legacy v1 (no timestamp).
   * Defaults to [] (v2 without suffix).
   */
  userIdentifiers?: UserIdentifier[] | null;
  /** Additional hash input fields appended after origin. Defaults to []. */
  extraFields?: string[];
}

function resolveCookie(
  cookies: Record<string, string | undefined>,
  primary: string,
  legacy: string,
  sapisid: string | undefined,
  fallback: boolean,
): string | undefined {
  return cookies[primary] ?? cookies[legacy] ?? (fallback ? sapisid : undefined);
}

/**
 * Builds the combined `Authorization` header value:
 * `SAPISIDHASH <token> SAPISID1PHASH <token> SAPISID3PHASH <token>`
 * All parts share a single timestamp. Parts whose cookie is missing
 * (and can't fall back) are omitted. Returns undefined when SAPISID is missing.
 *
 * Each token is an FPA v2 token from gapix's tokencrafter: with the default
 * `userIdentifiers: []` it is `<timestamp>_<sha1("timestamp cookie origin")>`;
 * with identifiers (e.g. email + focus-obfuscated Gaia ID) it becomes
 * `<timestamp>_<sha1("id0:id1 timestamp cookie origin")>_<keys>` such as
 * `1739700391_abc123def456_eu` (or `_eua` with a Workspace domain).
 */
export function buildSapisidAuthorizationHeader(
  cookieStringOrRecord: string | Record<string, string | undefined>,
  origin: string,
  options: SapisidAuthHeaderOptions = {},
): string | undefined {
  const cookies =
    typeof cookieStringOrRecord === 'string'
      ? parseCookies(cookieStringOrRecord, [
          'SAPISID',
          'SAPISID1P',
          'SAPISID3P',
          '__Secure-1PSAPISID',
          '__Secure-3PSAPISID',
        ])
      : cookieStringOrRecord;

  const sapisid = cookies['SAPISID'];
  if (!sapisid) return undefined;

  const fallback = options.fallbackToSapisid ?? true;
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const userIdentifiers = options.userIdentifiers ?? [];
  const extraFields = options.extraFields ?? [];

  const sapisid1p = resolveCookie(cookies, '__Secure-1PSAPISID', 'SAPISID1P', sapisid, fallback);
  const sapisid3p = resolveCookie(cookies, '__Secure-3PSAPISID', 'SAPISID3P', sapisid, fallback);

  const tokenFor = (cookie: string) =>
    getFirstPartyAuthTokenWithTimestamp(origin, cookie, userIdentifiers, extraFields, timestamp);

  const parts = [`SAPISIDHASH ${tokenFor(sapisid)}`];
  if (sapisid1p) {
    parts.push(`SAPISID1PHASH ${tokenFor(sapisid1p)}`);
  }
  if (sapisid3p) {
    parts.push(`SAPISID3PHASH ${tokenFor(sapisid3p)}`);
  }
  return parts.join(' ');
}

/**
 * Builds just the `Authorization` header from a ServiceConfig-like object,
 * threading FPA v2 identifiers/extra fields when present. Returns undefined
 * when cookies/origin (or SAPISID) are missing.
 */
export function buildAuthHeaderFromConfig(config: {
  cookies?: string;
  origin?: string;
  authUserIdentifiers?: UserIdentifier[] | null;
  authExtraFields?: string[];
  authTimestamp?: number;
}): string | undefined {
  if (!config.cookies || !config.origin) return undefined;
  return buildSapisidAuthorizationHeader(config.cookies, config.origin, {
    userIdentifiers: config.authUserIdentifiers ?? [],
    extraFields: config.authExtraFields ?? [],
    ...(config.authTimestamp !== undefined ? { timestamp: config.authTimestamp } : {}),
  });
}
