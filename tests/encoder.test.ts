import { describe, it, expect } from 'vitest';
import { encodeBatch } from '../src/transport/encoder';

describe('encoder', () => {
  it('should encode a single RPC call into batchexecute format', () => {
    const calls = [
      { rpcId: 'rpc1', args: ['arg1', 2, { key: 'value' }] }
    ];
    
    const result = encodeBatch(calls);
    
    // Modern batchexecute: [[[rpcId, argsJson, null, "generic"]]]
    const expectedPayload = [
      ["rpc1", JSON.stringify(['arg1', 2, { key: 'value' }]), null, "generic"]
    ];
    const expected = JSON.stringify([expectedPayload]);
    
    expect(result).toBe(expected);
  });

  it('should encode multiple RPC calls into batchexecute format', () => {
    const calls = [
      { rpcId: 'rpc1', args: ['arg1'] },
      { rpcId: 'rpc2', args: ['arg2', 'extra'] }
    ];
    
    const result = encodeBatch(calls);
    
    const expectedPayload = [
      ["rpc1", JSON.stringify(['arg1']), null, "generic"],
      ["rpc2", JSON.stringify(['arg2', 'extra']), null, "generic"]
    ];
    const expected = JSON.stringify([expectedPayload]);
    
    expect(result).toBe(expected);
  });
});
