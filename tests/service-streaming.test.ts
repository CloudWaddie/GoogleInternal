import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleInternal } from '../src/index';
import { z } from 'zod';

// Mock fetch
global.fetch = vi.fn();

describe('Service Streaming API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should stream multiple results', async () => {
    const client = new GoogleInternal({
      baseUrl: 'https://news.google.com',
      at: 'test-at'
    });

    const newsService = client.registerService('news', {
      baseUrl: 'https://news.google.com/_/NewsBackend'
    });

    const rpcId = 'testRpc';
    newsService.register('streamTest', {
      rpcId,
      mapArgs: (data: { query: string }) => [data.query],
      mapResult: (arr: any) => arr
    });

    const envelope1 = JSON.stringify([["wrb.fr", rpcId, "[\"result1\"]", null, null, null, "1"]]);
    const envelope2 = JSON.stringify([["wrb.fr", rpcId, "[\"result2\"]", null, null, null, "2"]]);
    const chunks = [
      ")]}'\n",
      `${envelope1.length}\n${envelope1}\n`,
      `${envelope2.length}\n${envelope2}\n`
    ];

    const mockStream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      }
    });

    (global.fetch as any).mockResolvedValue({
      ok: true,
      body: mockStream
    });

    const results = [];
    for await (const result of newsService.stream('streamTest', { query: 'test' })) {
      results.push(result);
    }

    expect(results).toEqual([["result1"], ["result2"]]);
  });

  it('should throw validation error before request', async () => {
    const client = new GoogleInternal({ baseUrl: 'https://news.google.com' });
    const service = client.registerService('test', { baseUrl: 'https://news.google.com' });

    service.register('validated', {
      rpcId: 'rpc',
      schema: z.object({ query: z.string().min(5) }),
      mapArgs: (d) => [d.query],
      mapResult: (r) => r
    });

    try {
      await (service as any).stream('validated', { query: 'abc' }).next();
      throw new Error('Should have thrown');
    } catch (e: any) {
      expect(e.name).toBe('ZodError');
    }

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should throw error if response.body is null', async () => {
    const client = new GoogleInternal({ baseUrl: 'https://news.google.com' });
    const service = client.registerService('test', { baseUrl: 'https://news.google.com' });
    service.register('test', { rpcId: 'r', mapArgs: (d) => [d], mapResult: (r) => r });

    (global.fetch as any).mockResolvedValue({
      ok: true,
      body: null
    });

    try {
      await (service as any).stream('test', {}).next();
      throw new Error('Should have thrown');
    } catch (e: any) {
      expect(e.message).toBe('Response body is null');
    }
  });

  it('should handle HTTP error', async () => {
    const client = new GoogleInternal({ baseUrl: 'https://news.google.com' });
    const service = client.registerService('test', { baseUrl: 'https://news.google.com' });
    service.register('test', { rpcId: 'r', mapArgs: (d) => [d], mapResult: (r) => r });

    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 500
    });

    try {
      await (service as any).stream('test', {}).next();
      throw new Error('Should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('HTTP error! status: 500');
    }
  });
});
