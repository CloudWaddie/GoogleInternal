import { ServiceConfig } from './types';
import { Service } from './registry/service';
import { BatchBuilder } from './batch/builder';

export class GoogleInternal {
  private services: Map<string, Service> = new Map();

  constructor(public globalConfig: Partial<ServiceConfig>) {}

  registerService(name: string, config: ServiceConfig): Service {
    const mergedConfig = { ...this.globalConfig, ...config };
    const service = new Service(mergedConfig as ServiceConfig);
    this.services.set(name, service);
    return service;
  }

  service<TService extends Service = Service>(name: string): TService {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service not found: ${name}`);
    }
    return service as TService;
  }

  newBatch(): BatchBuilder {
    return new BatchBuilder(this);
  }
}

export * from './types';
export * from './constants';
export { Service } from './registry/service';
export { BatchBuilder } from './batch/builder';
export { PartialBatchError } from './errors';
export { FieldMaskTree } from './utils/field-mask';
export { calculateChecksum, fnv1a32, stableStringify } from './utils/checksum';
