/**
 * Decodes a batchexecute response.
 * The format typically starts with an XSSI protection prefix: )]}'
 * Followed by one or more length-prefixed JSON chunks: [length]\n[JSON]\n
 */
export function decodeResponse(response: string): { rpcId: string; payload: any; index: string }[] {
  let content = response;
  
  // Step 2: Strip XSSI prefix
  const xssiPrefix = ")]}'\n";
  if (content.startsWith(xssiPrefix)) {
    content = content.substring(xssiPrefix.length);
  }

  const results: { rpcId: string; payload: any; index: string }[] = [];

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
 * Stateful decoder for chunked responses.
 * Handles cases where a chunk is split across multiple calls to decodeChunk.
 */
export class StreamingDecoder {
  private buffer: string = "";
  private hasStrippedXssi: boolean = false;

  /**
   * Processes a chunk of data from the stream and returns any fully parsed envelopes.
   */
  decodeChunk(data: string): { rpcId: string; payload: any; index: string }[] {
    this.buffer += data;

    // Step 1: Strip XSSI prefix if present at the very beginning
    if (!this.hasStrippedXssi) {
      const xssiPrefix = ")]}'\n";
      if (this.buffer.startsWith(xssiPrefix)) {
        this.buffer = this.buffer.substring(xssiPrefix.length);
        this.hasStrippedXssi = true;
      } else if (this.buffer.length >= xssiPrefix.length) {
        // We have enough data to know it's not the XSSI prefix, or we already passed it
        this.hasStrippedXssi = true;
      } else {
        // Not enough data yet to decide on XSSI prefix
        return [];
      }
    }

    const results: { rpcId: string; payload: any; index: string }[] = [];

    // Step 2: Parse length-prefixed chunks from the buffer
    while (true) {
      const nextNewline = this.buffer.indexOf('\n');
      if (nextNewline === -1) break;

      const lengthStr = this.buffer.substring(0, nextNewline).trim();
      if (lengthStr === "") {
        this.buffer = this.buffer.substring(nextNewline + 1);
        continue;
      }

      const length = parseInt(lengthStr, 10);
      if (isNaN(length)) {
        // If we can't parse a length, we might be in a bad state. 
        // For robustness, we'll just stop here, but in a real streaming scenario 
        // we might want to discard until the next newline or something similar.
        break;
      }

      const chunkStart = nextNewline + 1;
      const chunkEnd = chunkStart + length;

      // Ensure we have the full chunk in the buffer
      if (this.buffer.length < chunkEnd) break;

      const chunkStr = this.buffer.substring(chunkStart, chunkEnd);
      
      try {
        const chunk = JSON.parse(chunkStr);
        extractWrbEnvelopes(chunk, results);
      } catch (e) {
        // Ignore individual chunk parsing errors
      }

      // Remove processed chunk from buffer
      this.buffer = this.buffer.substring(chunkEnd);
    }

    return results;
  }
}

/**
 * Recursively extracts wrb.fr envelopes from a JSON structure.
 */
function extractWrbEnvelopes(data: any, results: { rpcId: string; payload: any; index: string }[]) {
  if (!Array.isArray(data)) return;

  if (data[0] === 'wrb.fr') {
    const rpcId = data[1];
    const payloadStr = data[2];
    const index = data[6];
    
    if (typeof rpcId === 'string' && typeof payloadStr === 'string' && typeof index === 'string') {
      try {
        const payload = JSON.parse(payloadStr);
        results.push({ rpcId, payload, index });
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
