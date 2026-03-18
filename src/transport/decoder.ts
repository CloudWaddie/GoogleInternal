/**
 * Decodes a batchexecute response.
 * The format typically starts with an XSSI protection prefix: )]}'
 * Followed by one or more length-prefixed JSON chunks: [length]\n[JSON]\n
 */
export function decodeResponse(response: string): { rpcId: string; payload: any }[] {
  let content = response;
  
  // Step 2: Strip XSSI prefix
  const xssiPrefix = ")]}'\n";
  if (content.startsWith(xssiPrefix)) {
    content = content.substring(xssiPrefix.length);
  }

  const results: { rpcId: string; payload: any }[] = [];

  // Step 3: Parse length-prefixed chunks
  let offset = 0;
  while (offset < content.length) {
    const nextNewline = content.indexOf('\n', offset);
    if (nextNewline === -1) break;

    const lengthStr = content.substring(offset, nextNewline).trim();
    if (lengthStr === "") {
      offset = nextNewline + 1;
      continue;
    }
    
    const length = parseInt(lengthStr, 10);
    if (isNaN(length)) {
      // If we can't parse a length, we might be at the end or in an unexpected format
      break;
    }

    const chunkStart = nextNewline + 1;
    const chunkEnd = chunkStart + length;
    
    // Ensure we don't go out of bounds
    if (chunkEnd > content.length) break;

    const chunkStr = content.substring(chunkStart, chunkEnd);
    
    try {
      const chunk = JSON.parse(chunkStr);
      // Step 4: Extract wrb.fr envelopes
      extractWrbEnvelopes(chunk, results);
    } catch (e) {
      // Ignore individual chunk parsing errors
    }

    offset = chunkEnd;
  }

  return results;
}

/**
 * Recursively extracts wrb.fr envelopes from a JSON structure.
 */
function extractWrbEnvelopes(data: any, results: { rpcId: string; payload: any }[]) {
  if (!Array.isArray(data)) return;

  if (data[0] === 'wrb.fr') {
    const rpcId = data[1];
    const payloadStr = data[2];
    
    if (typeof rpcId === 'string' && typeof payloadStr === 'string') {
      try {
        const payload = JSON.parse(payloadStr);
        results.push({ rpcId, payload });
      } catch (e) {
        // Failed to parse double-encoded payload
      }
    }
    return;
  }

  // If not a wrb.fr envelope itself, it might contain them
  for (const item of data) {
    extractWrbEnvelopes(item, results);
  }
}
