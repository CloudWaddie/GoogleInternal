import { describe, it, expect } from 'vitest';
import { extractMappingsFromChunk, findRpcPath, collectStrings } from '../src/extract';

describe('extractMappingsFromChunk', () => {
  it('extracts classic new-expression registrations', () => {
    const chunk = `_.yD=class extends _.MPb{};new _.yD("KqZy6d",class{},0,[_.Pg,!0,_.Sg,"/BardFrontendService.StreamGenerate"]);`;
    const { entries } = extractMappingsFromChunk(chunk);
    expect(entries).toContainEqual(['KqZy6d', 'BardFrontendService.StreamGenerate', 'yD']);
  });

  it('extracts 2026+ object-style registrations (conditional path)', () => {
    // Minified shape observed in gemini.google.com bundles after 2026-10-12:
    const chunk = `var q6b={Ub:"SO745e",Wb:_.nz?"/BardFrontendService.ShareCalendar":void 0,Xb:!1,Vb:class extends _.l{constructor(a){super(a)}},Yb:class extends _.l{constructor(a){super(a)}}};q6b[_.Xk]=!0;new _.rz(q6b);`;
    const { entries } = extractMappingsFromChunk(chunk);
    expect(entries).toContainEqual(['SO745e', 'BardFrontendService.ShareCalendar', null]);
  });

  it('extracts object-style registrations passed inline to new', () => {
    const chunk = `new _.rz({Ub:"KKERBf",Wb:"/BardFrontendService.StartPhoneVerification",Vb:class{}});`;
    const { entries } = extractMappingsFromChunk(chunk);
    expect(entries).toContainEqual(['KKERBf', 'BardFrontendService.StartPhoneVerification', null]);
  });

  it('ignores objects that have a path-like string but no rpcid', () => {
    const chunk = `var cfg={url:"/some.config.value",flag:!0};init(cfg);`;
    const { entries } = extractMappingsFromChunk(chunk);
    expect(entries).toEqual([]);
  });

  it('ignores plain state objects', () => {
    const chunk = `new _.Qu({status:"IDLE"});`;
    const { entries } = extractMappingsFromChunk(chunk);
    expect(entries).toEqual([]);
  });

  it('deduplicates nothing — same rpcid twice yields two entries (caller maps)', () => {
    const chunk = `var a={Ub:"SO745e",Wb:"/S.A",Vb:class{}};var b={Ub:"SO745e",Wb:"/S.A",Vb:class{}};`;
    const { entries } = extractMappingsFromChunk(chunk);
    expect(entries.filter(e => e[0] === 'SO745e').length).toBe(2);
  });

  it('still collects call types from registration classes', () => {
    const chunk = `_.eK=class extends _.MPb{constructor(a,b,c){super(a,b,c);this[_.Cua]="server_streaming"}};`;
    const { classTypes } = extractMappingsFromChunk(chunk);
    expect(classTypes).toContainEqual(['eK', 'server_streaming']);
  });
});

describe('findRpcPath / collectStrings helpers', () => {
  it('findRpcPath skips non-literal args and finds the path anywhere', () => {
    const chunk = `new _.yD("abc",CRb,BRb,[_.Pg,"/S.M"]);`;
    // Parse the arguments of a synthetic NewExpression via a wrapper script
    const { entries } = extractMappingsFromChunk(`new _.yD("abc",CRb,BRb,[_.Pg,"/S.M"]);`);
    expect(entries[0][0]).toBe('abc');
    expect(entries[0][1]).toBe('S.M');
  });

  it('collectStrings walks conditionals, arrays, nested objects and templates', () => {
    const ast = require('meriyah').parseScript(
      `var x = { a: cond ? "/S.M" : void 0, b: ["t1", { c: \`t2\` }] };`
    );
    const obj = (ast.body[0] as any).declarations[0].init;
    expect(collectStrings(obj)).toEqual(['/S.M', 't1', 't2']);
  });
});
