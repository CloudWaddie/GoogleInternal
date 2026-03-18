import { z } from 'zod';
import { ServiceConfig, Spec } from '../types';
import * as AuthModule from '../auth';
import * as Transport from '../transport';

export class Service {
  private specs: Map<string, Spec<any, any>> = new Map();

  constructor(public config: ServiceConfig) {}

  register<TSchema extends z.ZodTypeAny, TResult>(name: string, spec: Spec<TSchema, TResult>) {
    this.specs.set(name, spec);
  }

  getSpec(name: string): Spec<any, any> | undefined {
    return this.specs.get(name);
  }

  async execute<TResult = any>(name: string, data: any): Promise<TResult> {
    const spec = this.specs.get(name);
    if (!spec) {
      throw new Error(`Spec not found: ${name}`);
    }

    const validatedData = spec.schema ? spec.schema.parse(data) : data;
    const args = spec.mapArgs(validatedData);
    const body = Transport.encodeBatch([{ rpcId: spec.rpcId, args }]);

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    };

    if (this.config.cookies && this.config.origin) {
      const cookies = AuthModule.parseCookies(this.config.cookies, ['SAPISID']);
      if (cookies.SAPISID) {
        headers['Authorization'] = `SAPISIDHASH ${AuthModule.generateSapisidHash(cookies.SAPISID, this.config.origin)}`;
      }
      headers['Cookie'] = this.config.cookies;
    }

    const params = new URLSearchParams();
    params.append('f.req', body);
    if (this.config.at) {
      params.append('at', this.config.at);
    }

    const url = new URL(this.config.baseUrl);
    if (this.config.hl) url.searchParams.append('hl', this.config.hl);
    if (this.config.bl) url.searchParams.append('bl', this.config.bl);
    if (this.config.f_sid) url.searchParams.append('f.sid', this.config.f_sid);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const responseText = await response.text();
    const allResults = Transport.decodeResponse(responseText);
    const result = allResults.find(r => r.rpcId === spec.rpcId);

    if (!result) {
      throw new Error(`No result found for rpcId: ${spec.rpcId}`);
    }

    return spec.mapResult(result.payload);
  }

  async *stream<TSchema extends z.ZodTypeAny = any, TResult = any>(name: string, data: any): AsyncIterable<TResult> {
    const spec = this.specs.get(name);
    if (!spec) {
      throw new Error(`Spec not found: ${name}`);
    }

    const validatedData = spec.schema ? spec.schema.parse(data) : data;
    const args = spec.mapArgs(validatedData);
    const body = Transport.encodeBatch([{ rpcId: spec.rpcId, args }]);

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    };

    if (this.config.cookies && this.config.origin) {
      const cookies = AuthModule.parseCookies(this.config.cookies, ['SAPISID']);
      if (cookies.SAPISID) {
        headers['Authorization'] = `SAPISIDHASH ${AuthModule.generateSapisidHash(cookies.SAPISID, this.config.origin)}`;
      }
      headers['Cookie'] = this.config.cookies;
    }

    const params = new URLSearchParams();
    params.append('f.req', body);
    if (this.config.at) {
      params.append('at', this.config.at);
    }

    const url = new URL(this.config.baseUrl);
    if (this.config.hl) url.searchParams.append('hl', this.config.hl);
    if (this.config.bl) url.searchParams.append('bl', this.config.bl);
    if (this.config.f_sid) url.searchParams.append('f.sid', this.config.f_sid);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const decoder = new Transport.StreamingDecoder();
    const stream = (response.body as any).pipeThrough(new TextDecoderStream());

    for await (const chunk of stream) {
      const results = decoder.decodeChunk(chunk);
      for (const result of results) {
        if (result.rpcId === spec.rpcId) {
          yield spec.mapResult(result.payload);
        }
      }
    }
  }
}
