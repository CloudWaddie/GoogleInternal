import { z } from 'zod';
import type { UserIdentifier } from '../auth/tokencrafter';

export interface ServiceConfig {
  baseUrl: string;
  sourcePath?: string;
  hl?: string;
  bl?: string;
  f_sid?: string;
  at?: string;
  cookies?: string;
  origin?: string;
  /**
   * FPA v2 user identifiers embedded in the SAPISIDHASH hash (e/u/a).
   * - 'e': user's email address
   * - 'u': focus-obfuscated Gaia ID
   * - 'a': Workspace (dasher) app domain
   * Required by some *.clients6.google.com / *.googleapis.com APIs such as
   * drivefrontend-pa. Omit (or pass []) for the classic timestamp_hash token.
   */
  authUserIdentifiers?: UserIdentifier[] | null;
  /** Additional FPA hash input fields appended after origin. */
  authExtraFields?: string[];
  /** Override Unix-seconds timestamp (mainly for tests). Defaults to now. */
  authTimestamp?: number;
  
  // New options
  maxRetries?: number;
  retryDelay?: number; // ms
  retryMaxDelay?: number; // ms
  debug?: boolean;
  debugDumpRequest?: boolean;
  debugDumpPayload?: boolean;

  // Google-Native Engine Options
  fields?: string[];     // Field masks for pruning
  checksum?: boolean;    // Return checksum with result
  prettyPrint?: boolean; // Request formatted JSON
  errorFormat?: string;  // e.g. $.xgafv
  alt?: string;          // Output format
  
  // Advanced Parameters
  responseType?: 'chunked' | 'protobuf' | 'json';

  // Advanced Headers
  headers?: Record<string, string>;
  responseEncoding?: 'base64' | 'identity';
}

export interface Spec<TSchema extends z.ZodTypeAny = any, TResult = any> {
  rpcId: string;
  schema?: TSchema;
  mapArgs: (data: z.infer<TSchema>) => any[];
  mapResult: (arr: any[]) => TResult;
}
