import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cliProgress from 'cli-progress';
import { Worker } from 'worker_threads';
import { parseScript } from 'meriyah';
import * as estraverse from 'estraverse';
import { Agent, fetch as undiciFetch } from 'undici';

const CONCURRENCY_LIMIT = 60;
const FETCH_TIMEOUT = 15000;
// Short-lived batch job — use every core (previously reserved two, which
// halved throughput on 4-core CI runners and typical dev boxes).
const EXTRACT_WORKERS = Math.min(16, Math.max(2, os.cpus().length));

// Google serves the Gemini/Bard app pages with very large response
// headers (nonces, cookies, etc.) that exceed undici's default 16KB
// limit; raise it so fetch() doesn't fail with UND_ERR_HEADERS_OVERFLOW.
const FETCH_AGENT = new Agent({ maxHeaderSize: 262144 });

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

export interface ScrapeProgress {
  modulesCompleted: number;
  modulesTotal: number;
  chunksExtracted: number;
  chunksTotal: number;
  mappingsFound: number;
}

export interface ScrapeResult {
  mappings: Map<string, string>;
  /** rpcid -> call type (e.g. "unary", "server_streaming") when resolvable */
  mappingTypes: Map<string, string>;
  stats: {
    chunks: number;
    rpcClass: string | null;
    elapsedMs: number;
  };
}

async function fetchContent(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const res = await undiciFetch(url, { headers: DEFAULT_HEADERS, signal: controller.signal, dispatcher: FETCH_AGENT });
    clearTimeout(timeout);

    if (res.ok) {
      return await res.text();
    }
  } catch (e) {
    console.error(`[FETCH ERROR] ${url}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return null;
}

/**
 * Legacy diagnostic: locate the classic RPC registration class
 * (`_.X = class { getName(); getResponse(); matches(); constructor(a,b,c) }`).
 * Only invoked when the class-agnostic scan finds nothing — it re-parses
 * every chunk that mentions getName/getResponse, which is pure overhead
 * on modern bundles where the class-agnostic scan always succeeds.
 */
function probeClassicRpcClass(scriptContents: string[]): string | null {
  for (let i = 0; i < scriptContents.length; i++) {
    const content = scriptContents[i];
    if (!content.includes('getName') || !content.includes('getResponse')) continue;

    try {
      const ast = parseScript(content, { next: true });
      let found: string | null = null;
      estraverse.traverse(ast as any, {
        enter: (node: any) => {
          let className: string | null = null;
          let classBody: any = null;

          if (node.type === 'AssignmentExpression' &&
            node.left.type === 'MemberExpression' &&
            node.left.object.name === '_' &&
            node.right.type === 'ClassExpression') {
            className = node.left.property.name;
            classBody = node.right.body.body;
          }
          else if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init && node.init.type === 'ClassExpression') {
            className = node.id.name;
            classBody = node.init.body.body;
          }
          else if (node.type === 'ClassDeclaration' && node.id) {
            className = node.id.name;
            classBody = node.body.body;
          }

          if (className && classBody) {
            const methodNames = classBody
              .filter((m: any) => m.type === 'MethodDefinition')
              .map((m: any) => m.key.name || (m.key.type === 'Literal' ? m.key.value : null))
              .filter(Boolean);

            const hasRequiredMethods = ['getName', 'getInstance', 'getResponse', 'matches'].every(name =>
              methodNames.includes(name)
            );

            if (hasRequiredMethods) {
              const ctor = classBody.find((m: any) => m.kind === 'constructor');
              if (ctor && ctor.value.params.length === 3) {
                found = className;
                console.log(`[FOUND] RPC Class Candidate: _.${found} (in chunk ${i})`);
                return estraverse.VisitorOption.Break;
              }
            }
          }
        }
      });
      if (found) return found;
    } catch (e) {
      // Skip malformed
    }
  }
  return null;
}

export async function scrapeRpcMappings(
  targetUrl: string,
  onProgress?: (p: ScrapeProgress) => void
): Promise<ScrapeResult> {
  const started = Date.now();
  console.log(`[INIT] Target: ${targetUrl}`);

  let scriptContents: string[] = [];
  let scriptSrcBase = '';

  const isJsFile = targetUrl.includes('.js') || targetUrl.includes('/js/');

  if (isJsFile) {
    const content = await fetchContent(targetUrl);
    if (!content) throw new Error('Failed to fetch JS');
    scriptContents.push(content);
    scriptSrcBase = targetUrl;
  } else {
    console.log('[STEP] Fetching target page...');
    const html = await fetchContent(targetUrl);
    if (!html) throw new Error('Failed to fetch target page');
    const baseJsMatch = html.match(/<script[^>]+src="([^"]+)"[^>]+id="base[^"]*"/i) ||
      html.match(/<script[^>]+id="base[^"]*"[^>]+src="([^"]+)"/i);
    if (!baseJsMatch) throw new Error('No base script found');
    scriptSrcBase = baseJsMatch[1];
    const discoveryUrl = scriptSrcBase.replace('/dg=0/', '/dg=2/');
    const discoveryJs = await fetchContent(discoveryUrl);
    if (discoveryJs) scriptContents.push(discoveryJs);
  }

  const lastScript = scriptContents[0];
  const moduleMatch = lastScript.match(/_._ModuleManager_initialize\('([^']+)',\[/);

  const isTTY = process.stdout.isTTY;
  const multibar = isTTY ? new cliProgress.MultiBar({
    clearOnComplete: false,
    hideCursor: true,
    format: ' {bar} | {percentage}% | {value}/{total} | {task} {foundStr}',
  }, cliProgress.Presets.shades_grey) : null;

  const modules = moduleMatch ? moduleMatch[1].split('/') : [];
  if (modules.length > 0) {
    console.log(`[STEP] Fetching ${modules.length} modules...`);
    const fetchBar = multibar ? multibar.create(modules.length, 0, { task: 'Fetching modules', foundStr: '' }) : null;
    const pool = [...modules];
    let completed = 0;

    const workers = Array(CONCURRENCY_LIMIT).fill(null).map(async () => {
      while (pool.length > 0) {
        const modId = pool.shift();
        if (!modId) continue;

        if (modId !== '_b') {
          const moduleUrl = scriptSrcBase
            .replace(/excm=[^/?&;]+/, `excm=${modId}`)
            .replace(/([/?&;])m=[^/?&;]+/, `$1m=${modId}`);
          const content = await fetchContent(moduleUrl);
          if (content) scriptContents.push(content);
        }

        completed++;
        if (fetchBar) {
          fetchBar.increment(1);
        } else if (completed % 20 === 0 || completed === modules.length) {
          console.log(`[PROGRESS] Fetched ${completed}/${modules.length} modules...`);
        }
        onProgress?.({ modulesCompleted: completed, modulesTotal: modules.length, chunksExtracted: 0, chunksTotal: scriptContents.length, mappingsFound: 0 });
      }
    });
    await Promise.all(workers);
    if (multibar) multibar.stop();
    console.log(`[STEP] Successfully loaded ${scriptContents.length} total script chunks.`);
  }

  const mappings = new Map<string, string>();

  // Phase 2: class-agnostic extraction via a worker pool. Matches any
  // `new _.<Class>(...)` whose arguments contain a "/Service.Method" literal
  // plus object-style config registrations; handles both classic and 2026+
  // bundle shapes, so the legacy classic-class probe (Phase 1) only runs as
  // a diagnostic fallback when this yields nothing.
  console.log(`\n[PHASE 2] Extracting RPC mappings (generic class-agnostic scan, ${EXTRACT_WORKERS} workers)...`);
  const astBar = multibar ? multibar.create(scriptContents.length, 0, { task: 'Extracting RPCs', foundStr: '| Mappings: 0' }) : null;
  // Cheap string pre-filters before the expensive AST parse:
  // - registrations always flow through `new _.<Class>(...)`
  // - every recorded entry needs a "/Service.Method"-style string literal,
  //   so chunks without one cannot produce mappings and are skipped.
  // Mirrors the extractor's path semantics exactly (quoted string whose first
  // char is "/" and which contains "." anywhere — covers "/Svc.Method" and
  // "/pkg.Svc/Method" shapes). A chunk failing this cannot produce any entry.
  const HAS_PATH_LITERAL_RE = /["'`]\/[^"'`]*\.[^"'`]*["'`]/;
  const chunksToScan = scriptContents.filter(c => c.includes('new _.') && HAS_PATH_LITERAL_RE.test(c));

  const workerFile = path.join(__dirname, 'scraper-worker.js');
  // In ts-node dev mode the compiled .js doesn't exist — use the .ts source
  // and load ts-node inside the worker thread.
  const isTsNode = !fs.existsSync(workerFile);
  const workerPath = isTsNode ? path.join(__dirname, 'scraper-worker.ts') : workerFile;
  const workerExecArgv = isTsNode ? ['-r', 'ts-node/register'] : undefined;

  // Work-stealing pool: each worker pulls the next chunk as it finishes,
  // so no worker idles behind a giant chunk in a static batch.
  const workerResults: Array<{ entries: Array<[string, string, string | null]>; classTypes: Array<[string, string]> }> = [];
  const numWorkers = Math.max(1, Math.min(EXTRACT_WORKERS, chunksToScan.length));
  let nextIndex = 0;
  let processedCount = 0;
  // Running tally of raw matches (pre-dedup) so progress reporting shows
  // live numbers — the deduped `mappings` map is only built after the
  // pool finishes.
  let rawMatches = 0;

  const runWorker = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, { execArgv: workerExecArgv });
      worker.on('message', (msg: any) => {
        if (msg.type === 'result') {
          workerResults[msg.index] = { entries: msg.entries, classTypes: msg.classTypes };
          processedCount++;
          rawMatches += msg.entries?.length ?? 0;
          if (astBar) {
            astBar.update(processedCount, { foundStr: `| Mappings: ${rawMatches}` });
          } else if (processedCount % 50 === 0 || processedCount === chunksToScan.length) {
            console.log(`[PROGRESS] Scanned chunk ${processedCount}/${chunksToScan.length} | Found: ${rawMatches}`);
          }
          onProgress?.({ modulesCompleted: modules.length, modulesTotal: modules.length, chunksExtracted: processedCount, chunksTotal: chunksToScan.length, mappingsFound: rawMatches });
        } else if (msg.type === 'done') {
          worker.terminate();
          resolve();
          return;
        }
        const idx = nextIndex++;
        if (idx < chunksToScan.length) {
          worker.postMessage({ type: 'chunk', index: idx, content: chunksToScan[idx] });
        } else {
          worker.postMessage({ type: 'done' });
        }
      });
      worker.on('error', reject);
      const idx = nextIndex++;
      if (idx < chunksToScan.length) {
        worker.postMessage({ type: 'chunk', index: idx, content: chunksToScan[idx] });
      } else {
        worker.postMessage({ type: 'done' });
      }
    });

  await Promise.all(Array.from({ length: numWorkers }, runWorker));

  // Merge worker results: mappings, plus class types resolved per rpcid.
  // Two passes: class defs may live in DIFFERENT chunks than registrations,
  // so collect all classTypes first, then resolve each rpcid's call type.
  const mappingTypes = new Map<string, string>();
  {
    const classTypes = new Map<string, string>();
    const allEntries: Array<[string, string, string | null]> = [];
    for (const { entries, classTypes: perChunk } of workerResults) {
      for (const [className, callType] of perChunk) {
        if (!classTypes.has(className)) classTypes.set(className, callType);
      }
      allEntries.push(...entries);
    }
    for (const [id, servicePath, className] of allEntries) {
      mappings.set(id, servicePath);
      if (className && classTypes.has(className) && !mappingTypes.has(id)) {
        mappingTypes.set(id, classTypes.get(className)!);
      }
    }
  }

  if (astBar) astBar.update(chunksToScan.length, { foundStr: `| Mappings: ${mappings.size}` });
  if (multibar) multibar.stop();

  // Legacy-format diagnostic — only burn cycles on it when the
  // class-agnostic scan came up empty (i.e. an old-style bundle).
  let rpcClassProp: string | null = null;
  if (mappings.size === 0) {
    console.warn('[WARN] Class-agnostic scan found no mappings — probing for classic RPC registration class...');
    rpcClassProp = probeClassicRpcClass(scriptContents);
  }

  const elapsedMs = Date.now() - started;
  console.log('\n' + '='.repeat(50));
  console.log(`Extraction Complete!`);
  console.log(`RPC Class: ${rpcClassProp ? '_.' + rpcClassProp : 'generic (class-agnostic)'}`);
  console.log(`Unique RPCs: ${mappings.size}`);
  console.log(`With known call types: ${mappingTypes.size}`);
  console.log(`Elapsed: ${elapsedMs}ms`);
  console.log('='.repeat(50));

  return { mappings, mappingTypes, stats: { chunks: scriptContents.length, rpcClass: rpcClassProp, elapsedMs } };
}
