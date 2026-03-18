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

  it('should support multiple XSSI prefixes', () => {
    const prefixes = [")]}'\n\n", ")]}'\n", ")]}''"];
    
    for (const xssi of prefixes) {
      const payload = JSON.stringify(['wrb.fr', 'rpc1', JSON.stringify(['result1']), null, null, null, '1']);
      const response = `${xssi}${payload.length}\n${payload}\n`;
      
      const result = decodeResponse(response);
      
      expect(result, `Failed for prefix: ${JSON.stringify(xssi)}`).toEqual([
        { rpcId: 'rpc1', payload: ['result1'], index: '1' }
      ]);
    }
  });

  it('should handle recursive unescaping (double-encoded JSON)', () => {
    const xssi = ")]}'\n";
    // Double encoded: JSON.stringify(JSON.stringify(['nested']))
    const doubleEncoded = JSON.stringify(JSON.stringify(['nested']));
    const payload = JSON.stringify(['wrb.fr', 'rpc1', doubleEncoded, null, null, null, '1']);
    const response = `${xssi}${payload.length}\n${payload}\n`;
    
    const result = decodeResponse(response);
    
    expect(result).toEqual([
      { rpcId: 'rpc1', payload: ['nested'], index: '1' }
    ]);
  });

  it('should handle triple-encoded JSON', () => {
    const xssi = ")]}'\n";
    // Triple encoded
    const tripleEncoded = JSON.stringify(JSON.stringify(JSON.stringify(['triple'])));
    const payload = JSON.stringify(['wrb.fr', 'rpc1', tripleEncoded, null, null, null, '1']);
    const response = `${xssi}${payload.length}\n${payload}\n`;
    
    const result = decodeResponse(response);
    
    expect(result).toEqual([
      { rpcId: 'rpc1', payload: ['triple'], index: '1' }
    ]);
  });

  it('should extract payload from alternative positions (5 and 10)', () => {
    const xssi = ")]}'\n";
    
    // Position 5
    const p5 = JSON.stringify(['wrb.fr', 'rpc5', null, null, null, JSON.stringify(['res5']), '5']);
    // Position 10
    const p10 = JSON.stringify(['wrb.fr', 'rpc10', null, null, null, null, '10', null, null, null, JSON.stringify(['res10'])]);
    
    const response = `${xssi}${p5.length}\n${p5}\n${p10.length}\n${p10}\n`;
    
    const result = decodeResponse(response);
    
    expect(result).toEqual([
      { rpcId: 'rpc5', payload: ['res5'], index: '5' },
      { rpcId: 'rpc10', payload: ['res10'], index: '10' }
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
    const xssi = ")]}'\n";
    const inner = ['wrb.fr', 'rpc1', JSON.stringify(['res1']), null, null, null, '1'];
    const p1 = JSON.stringify([inner]);
    const response = `${xssi}${p1.length}\n${p1}\n`;
    
    const result = decodeResponse(response);
    
    expect(result).toEqual([
      { rpcId: 'rpc1', payload: ['res1'], index: '1' }
    ]);
  });

  it('should handle complex robust scenarios (combined)', () => {
    // Combine: Different XSSI prefix, nested encoding, and alternative position
    const xssi = ")]}''"; // A different prefix
    const tripleEncoded = JSON.stringify(JSON.stringify(JSON.stringify(['combined'])));
    // Position 10
    const p = JSON.stringify(['wrb.fr', 'rpc_combined', null, null, null, null, 'c1', null, null, null, tripleEncoded]);
    const response = `${xssi}${p.length}\n${p}\n`;
    
    const result = decodeResponse(response);
    
    expect(result).toEqual([
      { rpcId: 'rpc_combined', payload: ['combined'], index: 'c1' }
    ]);
  });
});
