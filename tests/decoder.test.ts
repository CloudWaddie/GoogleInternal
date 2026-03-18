import { describe, it, expect } from 'vitest';
import { decodeResponse } from '../src/transport/decoder';

describe('decoder', () => {
  it('should strip XSSI prefix and parse a single chunk', () => {
    const xssi = ")]}'\n";
    const payload = JSON.stringify(['wrb.fr', 'rpc1', JSON.stringify(['result1']), null, null, null, '1']);
    const response = `${xssi}${payload.length}\n${payload}\n`;
    
    const result = decodeResponse(response);
    
    expect(result).toEqual([
      { rpcId: 'rpc1', payload: ['result1'], index: '1' }
    ]);
  });

  it('should parse multiple chunks', () => {
    const xssi = ")]}'\n";
    const p1 = JSON.stringify(['wrb.fr', 'rpc1', JSON.stringify(['res1']), null, null, null, '1']);
    const p2 = JSON.stringify(['wrb.fr', 'rpc2', JSON.stringify(['res2']), null, null, null, '2']);
    const response = `${xssi}${p1.length}\n${p1}\n${p2.length}\n${p2}\n`;
    
    const result = decodeResponse(response);
    
    expect(result).toEqual([
      { rpcId: 'rpc1', payload: ['res1'], index: '1' },
      { rpcId: 'rpc2', payload: ['res2'], index: '2' }
    ]);
  });

  it('should ignore non-wrb.fr chunks', () => {
    const xssi = ")]}'\n";
    const p1 = JSON.stringify(['wrb.fr', 'rpc1', JSON.stringify(['res1']), null, null, null, '1']);
    const p2 = JSON.stringify(['other', 'data']);
    const response = `${xssi}${p1.length}\n${p1}\n${p2.length}\n${p2}\n`;
    
    const result = decodeResponse(response);
    
    expect(result).toEqual([
      { rpcId: 'rpc1', payload: ['res1'], index: '1' }
    ]);
  });

  it('should handle nested wrb.fr structure if encountered', () => {
    // Sometimes the chunk itself is an array of arrays
    const xssi = ")]}'\n";
    const inner = ['wrb.fr', 'rpc1', JSON.stringify(['res1']), null, null, null, '1'];
    const p1 = JSON.stringify([inner]);
    const response = `${xssi}${p1.length}\n${p1}\n`;
    
    const result = decodeResponse(response);
    
    expect(result).toEqual([
      { rpcId: 'rpc1', payload: ['res1'], index: '1' }
    ]);
  });
});
