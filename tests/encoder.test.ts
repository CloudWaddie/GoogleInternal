import { describe, it, expect } from 'vitest';
import { encodeBatch } from '../src/transport/encoder';

describe('encoder', () => {
  it('should encode a single RPC call into batchexecute format', () => {
    const calls = [
      { rpcId: 'rpc1', args: ['arg1', 2, { key: 'value' }] }
    ];
    
    const result = encodeBatch(calls);
    
    // Format: [[["rpcId", "[\"arg1\", ...]", null, "generic"]]]
    const expectedPayload = [['rpc1', JSON.stringify(['arg1', 2, { key: 'value' }]), null, 'generic']];
    const expected = JSON.stringify([[expectedPayload]]);
    
    expect(result).toBe(expected);
  });

  it('should encode multiple RPC calls into batchexecute format', () => {
    const calls = [
      { rpcId: 'rpc1', args: ['arg1'] },
      { rpcId: 'rpc2', args: ['arg2', 'extra'] }
    ];
    
    const result = encodeBatch(calls);
    
    const expectedPayload = [
      ['rpc1', JSON.stringify(['arg1']), null, 'generic'],
      ['rpc2', JSON.stringify(['arg2', 'extra']), null, 'generic']
    ];
    const expected = JSON.stringify([[expectedPayload]]);
    
    expect(result).toBe(expected);
  });

  it('should verify double-encoding for arguments', () => {
    const calls = [{ rpcId: 'rpc1', args: ['data'] }];
    const result = encodeBatch(calls);
    
    const decodedOuter = JSON.parse(result);
    // Format is [[[call1, call2, ...]]]
    // decodedOuter is [[[call1]]]
    // decodedOuter[0] is [[call1]]
    // decodedOuter[0][0] is [call1]
    const call1 = decodedOuter[0][0][0];
    const argsString = call1[1];
    
    // argsString should be a JSON string itself
    expect(typeof argsString).toBe('string');
    const args = JSON.parse(argsString);
    expect(args).toEqual(['data']);
  });
});
