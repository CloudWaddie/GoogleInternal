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
}

export interface Spec<TSchema extends z.ZodTypeAny = any, TResult = any> {
  rpcId: string;
  schema?: TSchema;
  mapArgs: (data: z.infer<TSchema>) => any[];
  mapResult: (arr: any[]) => TResult;
}
