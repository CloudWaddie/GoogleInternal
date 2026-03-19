
function recursiveUnescape(data: any, depth = 3): any {
  if (typeof data !== 'string' || depth <= 0) return data;
  try {
    const parsed = JSON.parse(data);
    // If it's a string that was double-encoded, try again
    if (typeof parsed === 'string') {
      return recursiveUnescape(parsed, depth - 1);
    }
    return parsed;
  } catch {
    return data;
  }
}

function extractWrbEnvelopes(data: any, results: { rpcId: string; payload: any; index: string }[]) {
  if (!Array.isArray(data)) return;

  if (data[0] === 'wrb.fr') {
    const rpcId = data[1];
    // Check positions 2, 5, 10 for payload
    const rawPayload = data[2] ?? data[5] ?? data[10];
    const index = data[6];
    
    if (typeof rpcId === 'string' && typeof index === 'string') {
      const payload = recursiveUnescape(rawPayload);
      results.push({ rpcId, payload, index });
    }
    return;
  }

  for (const item of data) {
    extractWrbEnvelopes(item, results);
  }
}

const XSSI_PREFIXES = [ "))}'\n\n", "))}'\n", "))}''"];

/**
 * Decodes a batchexecute response.
 * The format typically starts with an XSSI protection prefix.
 * Followed by one or more length-prefixed JSON chunks: [length]\n[JSON]\n
 */
export function decodeResponse(response: string): { rpcId: string; payload: any; index: string }[] {
  let content = response;
  
  // Step 1: Strip XSSI prefix
  for (const prefix of XSSI_PREFIXES) {
    if (content.startsWith(prefix)) {
      content = content.substring(prefix.length);
      break;
    }
  }

  const results: { rpcId: string; payload: any; index: string }[] = [];

  // Step 2: Parse length-prefixed chunks
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
      // Step 3: Extract wrb.fr envelopes
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
  decodeChunk(data: string, encoding?: string): { rpcId: string; payload: any; index: string }[] {
    let chunkData = data;
    if (encoding === 'base64') {
      try {
        chunkData = Buffer.from(data, 'base64').toString('utf-8');
      } catch (e) {
        // Fallback
      }
    }
    this.buffer += chunkData;

    // Step 1: Strip XSSI prefix if present at the very beginning
    if (!this.hasStrippedXssi) {
      const match = XSSI_PREFIXES.find(p => this.buffer.startsWith(p));
      if (match) {
        this.buffer = this.buffer.substring(match.length);
        this.hasStrippedXssi = true;
      } else {
        // Check if the buffer could still be an XSSI prefix
        const couldBePrefix = XSSI_PREFIXES.some(p => p.startsWith(this.buffer));
        if (!couldBePrefix) {
          this.hasStrippedXssi = true;
        } else {
          // Wait for more data
          return [];
        }
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
