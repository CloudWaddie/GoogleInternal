import { Spec, ServiceConfig } from '../types';
import * as AuthModule from '../auth';
import * as Transport from '../transport';
import { PartialBatchError } from '../errors';

export class BatchBuilder {
  private items: { serviceName: string; specName: string; data: any }[] = [];

  constructor(private client: any) {}

  add(serviceName: string, specName: string, data: any) {
    this.items.push({ serviceName, specName, data });
    return this;
  }

  async execute(): Promise<any[]> {
    if (this.items.length === 0) return [];

    const calls: { rpcId: string; args: any[] }[] = [];
    const specs: Spec[] = [];
    
    let baseConfig: ServiceConfig | undefined;

    for (const item of this.items) {
      const service = this.client.service(item.serviceName);
      if (!baseConfig) baseConfig = service.config;
      
      const spec = service.getSpec(item.specName);
      if (!spec) throw new Error(`Spec not found: ${item.serviceName}.${item.specName}`);
      
      specs.push(spec);
      calls.push({ rpcId: spec.rpcId, args: spec.mapArgs(item.data) });
    }

    if (!baseConfig) throw new Error("No service config available");

    const body = Transport.encodeBatch(calls);
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    };

    if (baseConfig.cookies && baseConfig.origin) {
      const cookies = AuthModule.parseCookies(baseConfig.cookies, ['SAPISID']);
      if (cookies.SAPISID) {
        headers['Authorization'] = `SAPISIDHASH ${AuthModule.generateSapisidHash(cookies.SAPISID, baseConfig.origin)}`;
      }
      headers['Cookie'] = baseConfig.cookies;
    }

    const params = new URLSearchParams();
    params.append('f.req', body);
    if (baseConfig.at) {
      params.append('at', baseConfig.at);
    }

    const url = new URL(baseConfig.baseUrl);
    if (baseConfig.hl) url.searchParams.append('hl', baseConfig.hl);
    if (baseConfig.bl) url.searchParams.append('bl', baseConfig.bl);
    if (baseConfig.f_sid) url.searchParams.append('f.sid', baseConfig.f_sid);

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

    const finalResults: any[] = new Array(this.items.length);
    const errors: Record<number, Error> = {};

    for (let i = 0; i < this.items.length; i++) {
      const spec = specs[i];
      const result = allResults.find(r => r.index === (i + 1).toString());
      
      if (result) {
        try {
          finalResults[i] = spec.mapResult(result.payload);
        } catch (e) {
          errors[i] = e instanceof Error ? e : new Error(String(e));
        }
      } else {
        errors[i] = new Error(`No result found for item ${i} (index: ${i + 1})`);
      }
    }

    if (Object.keys(errors).length > 0) {
      throw new PartialBatchError(finalResults, errors);
    }

    return finalResults;
  }
}
