import { describe, it, expect, vi } from 'vitest';
import { GoogleInternal } from '../src';
import { PartialBatchError } from '../src/errors';

describe('Batching', () => {
  it('should execute multiple RPCs in one batch', async () => {
    const client = new GoogleInternal({ baseUrl: 'https://example.com' });
    const service1 = client.registerService('service1', { baseUrl: 'https://example.com/s1' });
    const service2 = client.registerService('service2', { baseUrl: 'https://example.com/s2' });

    service1.register('rpc1', {
      rpcId: 'rpc1_id',
      mapArgs: (data: any) => [data.id],
      mapResult: (payload: any) => payload[0],
    });

    service2.register('rpc2', {
      rpcId: 'rpc2_id',
      mapArgs: (data: any) => [data.name],
      mapResult: (payload: any) => payload[1],
    });

    // Mock fetch - now with proper indices at position 6
    const json = JSON.stringify([
      ["wrb.fr","rpc1_id","[\"result1\"]",null,null,null,"1"],
      ["wrb.fr","rpc2_id","[null,\"result2\"]",null,null,null,"2"]
    ]);
    
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(`)]}'\n${json.length}\n${json}\n`),
      })
    );

    const batch = client.newBatch();
    batch.add('service1', 'rpc1', { id: 1 });
    batch.add('service2', 'rpc2', { name: 'test' });

    const results = await batch.execute();

    expect(results).toEqual(['result1', 'result2']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('should throw PartialBatchError when some RPCs fail', async () => {
    const client = new GoogleInternal({ baseUrl: 'https://example.com' });
    const service1 = client.registerService('service1', { baseUrl: 'https://example.com/s1' });
    const service2 = client.registerService('service2', { baseUrl: 'https://example.com/s2' });

    service1.register('rpc1', {
      rpcId: 'rpc1_id',
      mapArgs: (data: any) => [data.id],
      mapResult: (payload: any) => payload[0],
    });

    service2.register('rpc2', {
      rpcId: 'rpc2_id',
      mapArgs: (data: any) => [data.name],
      mapResult: (payload: any) => payload[1],
    });

    // Mock fetch - only rpc1_id (index "1") is returned
    const json = JSON.stringify([
      ["wrb.fr","rpc1_id","[\"result1\"]",null,null,null,"1"]
    ]);

    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(`)]}'\n${json.length}\n${json}\n`),
      })
    );

    const batch = client.newBatch();
    batch.add('service1', 'rpc1', { id: 1 });
    batch.add('service2', 'rpc2', { name: 'test' });

    try {
      await batch.execute();
      throw new Error('Should have thrown PartialBatchError');
    } catch (error: any) {
      if (error.message === 'Should have thrown PartialBatchError') {
        throw error;
      }
      expect(error).toBeInstanceOf(PartialBatchError);
      const partialError = error as PartialBatchError;
      expect(partialError.results).toEqual(['result1', undefined]);
      expect(partialError.errors[1]).toBeDefined();
      expect(partialError.errors[1].message).toContain('index: 2');
    }
  });
});
