export function encodeBatch(calls: { rpcId: string, args: any[] }[]): string {
  const payload = calls.map((c, i) => [c.rpcId, JSON.stringify(c.args), null, (i + 1).toString()]);
  return JSON.stringify([[payload]]);
}
