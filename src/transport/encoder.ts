export function encodeBatch(calls: { rpcId: string, args: any[] }[]): string {
  const payload = calls.map(c => [c.rpcId, JSON.stringify(c.args), null, "generic"]);
  return JSON.stringify([[payload]]);
}
