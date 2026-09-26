import { createHash } from 'crypto';

/**
 * User identifier for First-Party auth v2 tokens.
 * - 'e': user's email address
 * - 'u': user's focus-obfuscated Gaia ID
 * - 'a': user account's app domain (dasher accounts only)
 */
export interface UserIdentifier {
  key: string;
  value: string;
}

/**
 * Extracts the origin (scheme + host + port) from a location href.
 * Mirrors gapix.util.getOrigin().
 */
export function getOrigin(location: string): string {
  try {
    return new URL(location).origin;
  } catch {
    const match = location.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*)/);
    return match ? match[1] : location;
  }
}

/**
 * Lowercase hex SHA-1 digest of the input.
 * Mirrors gapix.auth_firstparty.tokencrafter.computeSha1_().
 */
export function computeSha1(toHash: string): string {
  return createHash('sha1').update(toHash, 'utf8').digest('hex').toLowerCase();
}

/**
 * Builds the First-Party auth token.
 * - v1 (userIdentifiers == null): `sha1("<cookie> <origin>[ <extra>...]")`
 * - v2 (userIdentifiers is an Array): `"<timestamp>_<sha1>[_<suffix>]"`
 *   where sha1 covers `"[<values joined by :> ]<timestamp> <cookie> <origin>[ <extra>...]"`
 *   and suffix is the concatenated identifier keys (e.g. ["e","u"] -> "eu",
 *   ["e","u","a"] -> "eua" for dasher/Workspace accounts).
 */
export function getFirstPartyAuthToken(
  origin: string,
  sessionCookie: string,
  userIdentifiers: UserIdentifier[] | null | undefined,
  extraFields: string[],
): string {
  return getFirstPartyAuthTokenWithTimestamp(
    origin,
    sessionCookie,
    userIdentifiers,
    extraFields,
    Math.floor(new Date().getTime() / 1000),
  );
}

/**
 * Same as {@link getFirstPartyAuthToken} but with an explicit Unix-seconds
 * timestamp. Used so SAPISID/1P/3P parts can share one timestamp in a single
 * `Authorization` header, and for deterministic tests.
 */
export function getFirstPartyAuthTokenWithTimestamp(
  origin: string,
  sessionCookie: string,
  userIdentifiers: UserIdentifier[] | null | undefined,
  extraFields: string[],
  timestamp: number,
): string {
  const version = Array.isArray(userIdentifiers) ? 2 : 1;

  if (version === 1) {
    const sha1Parts: string[] = [sessionCookie, origin, ...extraFields];
    return computeSha1(sha1Parts.join(' '));
  }

  const identifiers: string[] = [];
  const suffix: string[] = [];
  for (const element of userIdentifiers as UserIdentifier[]) {
    suffix.push(element.key);
    identifiers.push(element.value);
  }

  const sha1Parts: string[] =
    identifiers.length === 0
      ? [String(timestamp), sessionCookie, origin]
      : [`${identifiers.join(':')}`, String(timestamp), sessionCookie, origin];
  sha1Parts.push(...extraFields);
  const sha1 = computeSha1(sha1Parts.join(' '));

  const tokenParts: Array<string | number> = [timestamp, sha1];
  if (suffix.length !== 0) {
    tokenParts.push(suffix.join(''));
  }
  return tokenParts.join('_');
}

/**
 * If the user is logged in, returns a value for the Authorization header
 * used in First-Party authentication and OAuth 2 session_state.
 * Returns null when location, apiSessionCookieValue, or authScheme is missing.
 */
export function createAuthHeaderValueForFirstParty(
  location: string,
  apiSessionCookieValue: string,
  authScheme: string,
  opt_userIdentifiers?: UserIdentifier[] | null,
  opt_extraFields?: string[],
): string | null {
  if (!!location && !!apiSessionCookieValue && !!authScheme) {
    return [
      authScheme,
      getFirstPartyAuthToken(
        getOrigin(location),
        apiSessionCookieValue,
        opt_userIdentifiers ?? null,
        opt_extraFields ?? [],
      ),
    ].join(' ');
  }
  return null;
}

/**
 * Four-hex-digit digest used to validate versionInfos in the LSOLH cookie
 * (OAuth 2 approval-state invalidations). See go/lsolh.
 * Returns null when opt_versionInfos is empty/missing.
 */
export function computeVersionInfoDigest(
  opt_versionInfos?: string | null,
  opt_sessionCookie?: string | null,
): string | null {
  if (!opt_versionInfos) return null;
  const parts: string[] = [opt_versionInfos];
  if (!!opt_sessionCookie) parts.push(opt_sessionCookie);
  return computeSha1(parts.join(' ')).substring(0, 4);
}
