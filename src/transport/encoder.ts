/**
 * Encodes a batch of RPC requests into the format expected by Google's batchexecute.
 * Format: [[[rpcId, argsJson, null, "generic"], ...]]
 */
export function encodeBatch(requests: { rpcId: string; args: any[] }[]): string {
  const encoded = requests.map(req => [
    req.rpcId,
    JSON.stringify(req.args),
    null,
    "generic" // Added to match your working fetch
  ]);
  return JSON.stringify([encoded]);
}
