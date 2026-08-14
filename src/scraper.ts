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
const EXTRACT_WORKERS = Math.min(8, Math.max(2, os.cpus().length - 2));

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

  let rpcClassProp: string | null = null;
  const mappings = new Map<string, string>();

  // Phase 1 (best-effort): classic RPC registration class discovery.
  for (let i = 0; i < scriptContents.length; i++) {
    const content = scriptContents[i];
    if (!content.includes('getName') || !content.includes('getResponse')) continue;

    try {
      const ast = parseScript(content, { next: true });
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
                rpcClassProp = className;
                console.log(`[FOUND] RPC Class Candidate: _.${rpcClassProp} (in chunk ${i})`);
                return estraverse.VisitorOption.Break;
              }
            }
          }
        }
      });
      if (rpcClassProp) break;
    } catch (e) {
      // Skip malformed
    }
  }

  if (!rpcClassProp) {
    console.warn('[WARN] Could not find classic RPC registration class — falling back to generic scan.');
  }

  // Phase 2: class-agnostic extraction via a worker pool. Matches any
  // `new _.<Class>(...)` whose arguments contain a "/Service.Method" literal.
  console.log(`\n[PHASE 2] Extracting RPC mappings (generic class-agnostic scan, ${EXTRACT_WORKERS} workers)...`);
  const astBar = multibar ? multibar.create(scriptContents.length, 0, { task: 'Extracting RPCs', foundStr: '| Mappings: 0' }) : null;
  const chunksToScan = scriptContents.filter(c => c.includes('new _.'));

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

  const runWorker = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, { execArgv: workerExecArgv });
      worker.on('message', (msg: any) => {
        if (msg.type === 'result') {
          workerResults[msg.index] = { entries: msg.entries, classTypes: msg.classTypes };
          processedCount++;
          if (astBar) {
            astBar.update(processedCount, { foundStr: `| Mappings: ${mappings.size}` });
          } else if (processedCount % 50 === 0 || processedCount === chunksToScan.length) {
            console.log(`[PROGRESS] Scanned chunk ${processedCount}/${chunksToScan.length} | Found: ${mappings.size}`);
          }
          onProgress?.({ modulesCompleted: modules.length, modulesTotal: modules.length, chunksExtracted: processedCount, chunksTotal: chunksToScan.length, mappingsFound: mappings.size });
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

const isCli = process.argv[1] && /scraper\.(ts|js)$/.test(process.argv[1]);
if (isCli) {
  const target = process.argv.find(arg => arg.startsWith('http'));
  if (!target) {
    console.error('Usage: npm run scrape-rpc <url>');
    process.exit(1);
  }

  scrapeRpcMappings(target).then(({ mappings, mappingTypes }) => {
    const outputLines = Array.from(mappings.entries())
      .map(([id, name]) => `${id}: ${name}`)
      .sort();
    const outputPath = path.join(process.cwd(), 'rpc_mappings.txt');
    fs.writeFileSync(outputPath, outputLines.join('\n'));

    // Persist call types too (unary / server_streaming / ...) so the info
    // survives beyond a single run.
    const typeLines = Array.from(mappingTypes.entries())
      .map(([id, type]) => `${id}: ${type}`)
      .sort();
    const typePath = path.join(process.cwd(), 'rpc_types.txt');
    fs.writeFileSync(typePath, typeLines.join('\n'));

    console.log(`Output: ${outputPath}`);
    console.log(`Call types: ${typePath}`);
  });
}
