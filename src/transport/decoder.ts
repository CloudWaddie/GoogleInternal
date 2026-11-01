
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
    const rawPayload = data[2] ?? data[5] ?? data[10];
    const index = data[6];
    
    if (typeof rpcId === 'string') {
      const payload = recursiveUnescape(rawPayload);
      results.push({ rpcId, payload, index: String(index || '') });
    }
    return;
  }

  for (const item of data) {
    extractWrbEnvelopes(item, results);
  }
}

const XSSI_PREFIXES = [ ")]}'\n\n", ")]}'\n", ")]}''"];

/**
 * Decodes a batchexecute response.
 * The format typically starts with an XSSI protection prefix.
 * Followed by one or more length-prefixed JSON chunks: [length]\n[JSON]\n
 */
export function decodeResponse(response: string): { rpcId: string; payload: any; index: string }[] {
  let contentStr = response;
  
  // Step 1: Strip XSSI prefix flexibly
  const xssiMatch = contentStr.match(/^\)\]\}'[\s\n\r]*/);
  if (xssiMatch) {
    contentStr = contentStr.substring(xssiMatch[0].length);
    // Legacy prefix variant ")]}''" leaves a stray quote behind
    if (contentStr.startsWith("'")) contentStr = contentStr.substring(1);
  }

  const results: { rpcId: string; payload: any; index: string }[] = [];
  
  // Step 2: Line-based parsing. batchexecute chunks are minified JSON on single lines.
  const lines = contentStr.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^\d+$/.test(line)) {
      // This is a length line
      const nextLine = lines[i + 1];
      if (nextLine) {
        try {
          const chunk = JSON.parse(nextLine);
          extractWrbEnvelopes(chunk, results);
          i++; // Skip the JSON line
        } catch (e) {
          // If next line isn't valid JSON, maybe the length line wasn't actually a length line
          // or the JSON is split (rare in batchexecute)
        }
      }
    }
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

    // Step 1: Strip XSSI prefix flexibly
    if (!this.hasStrippedXssi) {
      const xssiMatch = this.buffer.match(/^\)\]\}'[\s\n\r]*/);
      if (xssiMatch) {
        this.buffer = this.buffer.substring(xssiMatch[0].length);
        // Legacy prefix variant ")]}''" leaves a stray quote behind
        if (this.buffer.startsWith("'")) this.buffer = this.buffer.substring(1);
        this.hasStrippedXssi = true;
      } else if (this.buffer.length > 20) {
        // If we haven't found the prefix in the first 20 chars, assume it's not there or already stripped
        this.hasStrippedXssi = true;
      } else {
        return []; // Wait for more data to check prefix
      }
    }

    const results: { rpcId: string; payload: any; index: string }[] = [];

    // Step 2: Length-driven parsing from buffer. Each chunk is a decimal
    // length line followed by exactly `length` characters of JSON. A
    // trailing newline after the JSON is optional (stream end may cut
    // right after the payload), so we slice by length instead of waiting
    // for a second newline.
    while (true) {
      const nextNewline = this.buffer.indexOf('\n');
      if (nextNewline === -1) break;

      const line = this.buffer.substring(0, nextNewline).trim();

      if (/^\d+$/.test(line)) {
        const length = parseInt(line, 10);
        const payloadStart = nextNewline + 1;
        if (Number.isFinite(length) && length > 0) {
          // Wait until the full payload (length chars) is buffered.
          if (this.buffer.length - payloadStart < length) break;

          const jsonChunk = this.buffer.substring(payloadStart, payloadStart + length).trim();
          try {
            const chunk = JSON.parse(jsonChunk);
            extractWrbEnvelopes(chunk, results);
            this.buffer = this.buffer.substring(payloadStart + length);
          } catch (e) {
            // Length didn't lead to valid JSON — treat the line as data and
            // advance past it so a later valid chunk can still parse.
            this.buffer = this.buffer.substring(nextNewline + 1);
          }
          continue;
        }
        // Zero/invalid length — skip the line.
        this.buffer = this.buffer.substring(nextNewline + 1);
      } else {
        // Not a length line, skip it
        this.buffer = this.buffer.substring(nextNewline + 1);
      }
    }

    return results;
  }
}
