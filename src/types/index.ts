import { z } from 'zod';

export interface ServiceConfig {
  baseUrl: string;
  hl?: string;
  bl?: string;
  f_sid?: string;
  at?: string;
  cookies?: string;
  origin?: string;
  
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
