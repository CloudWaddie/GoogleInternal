import { describe, it, expect } from 'vitest';
import { StreamingDecoder } from '../src/transport/decoder';

describe('StreamingDecoder', () => {
  it('should handle partial length-prefix', () => {
    const decoder = new StreamingDecoder();
    const p1 = JSON.stringify(['wrb.fr', 'rpc1', JSON.stringify(['res1']), null, null, null, '1']);
    const length = p1.length.toString();
    
    // Split length "123" into "1" and "23\n"
    const r1 = decoder.decodeChunk(length.substring(0, 1));
    expect(r1).toEqual([]);
    
    const r2 = decoder.decodeChunk(length.substring(1) + '\n' + p1);
    expect(r2).toEqual([{ rpcId: 'rpc1', payload: ['res1'], index: '1' }]);
  });

  it('should handle partial payload', () => {
    const decoder = new StreamingDecoder();
    const p1 = JSON.stringify(['wrb.fr', 'rpc1', JSON.stringify(['res1']), null, null, null, '1']);
    const length = p1.length.toString();
    const data = length + '\n' + p1;
    
    const splitIndex = Math.floor(data.length / 2);
    const r1 = decoder.decodeChunk(data.substring(0, splitIndex));
    expect(r1).toEqual([]);
    
    const r2 = decoder.decodeChunk(data.substring(splitIndex));
    expect(r2).toEqual([{ rpcId: 'rpc1', payload: ['res1'], index: '1' }]);
  });

  it('should handle multiple chunks in one call', () => {
    const decoder = new StreamingDecoder();
    const p1 = JSON.stringify(['wrb.fr', 'rpc1', JSON.stringify(['res1']), null, null, null, '1']);
    const p2 = JSON.stringify(['wrb.fr', 'rpc2', JSON.stringify(['res2']), null, null, null, '2']);
    const data = `${p1.length}\n${p1}${p2.length}\n${p2}`;
    
    const result = decoder.decodeChunk(data);
    expect(result).toEqual([
      { rpcId: 'rpc1', payload: ['res1'], index: '1' },
      { rpcId: 'rpc2', payload: ['res2'], index: '2' }
    ]);
  });

  it('should handle XSSI prefix', () => {
    const decoder = new StreamingDecoder();
    const xssi = ")]}'\n";
    const p1 = JSON.stringify(['wrb.fr', 'rpc1', JSON.stringify(['res1']), null, null, null, '1']);
    const data = xssi + p1.length + '\n' + p1;
    
    const result = decoder.decodeChunk(data);
    expect(result).toEqual([{ rpcId: 'rpc1', payload: ['res1'], index: '1' }]);
  });

  it('should maintain state across many small chunks', () => {
    const decoder = new StreamingDecoder();
    const p1 = JSON.stringify(['wrb.fr', 'rpc1', JSON.stringify(['res1']), null, null, null, '1']);
    const fullData = p1.length + '\n' + p1;
    
    const results: any[] = [];
    for (let i = 0; i < fullData.length; i++) {
      results.push(...decoder.decodeChunk(fullData[i]));
    }
    
    expect(results).toEqual([{ rpcId: 'rpc1', payload: ['res1'], index: '1' }]);
  });

  it('should handle complex mixed data and nested structures', () => {
    const decoder = new StreamingDecoder();
    const p1 = JSON.stringify(['other', 'data']);
    const p2 = JSON.stringify([['wrb.fr', 'rpc1', JSON.stringify({foo: 'bar'}), null, null, null, '0']]);
    
    const data = `${p1.length}\n${p1}${p2.length}\n${p2}`;
    const result = decoder.decodeChunk(data);
    
    expect(result).toEqual([
      { rpcId: 'rpc1', payload: {foo: 'bar'}, index: '0' }
    ]);
  });
});
