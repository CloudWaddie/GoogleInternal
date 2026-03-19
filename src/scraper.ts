import * as fs from 'fs';
import * as path from 'path';
import * as cliProgress from 'cli-progress';
import { parseScript } from 'meriyah';
import * as estraverse from 'estraverse';

const CONCURRENCY_LIMIT = 30;
const FETCH_TIMEOUT = 15000;

async function fetchContent(url: string, headers: any): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);
    
    if (res.ok) {
      return await res.text();
    }
  } catch (e) {
    console.error(`[FETCH ERROR] ${url}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return null;
}

async function scrapeRpcMappings(targetUrl: string) {
  console.log(`[INIT] Target: ${targetUrl}`);
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  try {
    let scriptContents: string[] = [];
    let scriptSrcBase = '';

    const isJsFile = targetUrl.includes('.js') || targetUrl.includes('/js/');

    if (isJsFile) {
        const content = await fetchContent(targetUrl, headers);
        if (!content) throw new Error('Failed to fetch JS');
        scriptContents.push(content);
        scriptSrcBase = targetUrl;
    } else {
        console.log('[STEP] Fetching target page...');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
        const res = await fetch(targetUrl, { headers, signal: controller.signal });
        clearTimeout(timeout);
        const html = await res.text();
        const baseJsMatch = html.match(/<script[^>]+src="([^"]+)"[^>]+id="base[^"]*"/i) || 
                            html.match(/<script[^>]+id="base[^"]*"[^>]+src="([^"]+)"/i);
        if (!baseJsMatch) {
          console.error('[ERROR] No base script found.');
          return;
        }
        scriptSrcBase = baseJsMatch[1];
        const discoveryUrl = scriptSrcBase.replace('/dg=0/', '/dg=2/');
        const discoveryJs = await fetchContent(discoveryUrl, headers);
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

    if (moduleMatch) {
      const modules = moduleMatch[1].split('/');
      console.log(`[STEP] Fetching ${modules.length} modules...`);
      const fetchBar = multibar ? multibar.create(modules.length, 0, { task: 'Fetching modules', foundStr: '' }) : null;
      const pool = [...modules];
      let completed = 0;
      
      const workers = Array(CONCURRENCY_LIMIT).fill(null).map(async (_, workerId) => {
        while (pool.length > 0) {
          const modId = pool.shift();
          if (!modId) continue;
          
          if (modId === '_b') { 
            completed++;
            if (fetchBar) fetchBar.increment(1);
            continue; 
          }

          let moduleUrl = scriptSrcBase
            .replace(/excm=[^/?&;]+/, `excm=${modId}`)
            .replace(/([/?&;])m=[^/?&;]+/, `$1m=${modId}`);
          
          const content = await fetchContent(moduleUrl, headers);
          if (content) scriptContents.push(content);
          
          completed++;
          if (fetchBar) {
            fetchBar.increment(1);
          } else if (completed % 20 === 0 || completed === modules.length) {
            console.log(`[PROGRESS] Fetched ${completed}/${modules.length} modules...`);
          }
        }
      });
      await Promise.all(workers);
      if (multibar) multibar.stop();
      console.log(`[STEP] Successfully loaded ${scriptContents.length} total script chunks.`);
    }

    let rpcClassProp: string | null = null;
    const mappings = new Map<string, string>();

    // Phase 1: Find the RPC Class Name
    console.log('\n[PHASE 1] Searching for RPC Registration Class...');
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
                const ctorArgs = ctor ? ctor.value.params.length : 0;
                
                if (ctorArgs === 3) {
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
        console.error('[ERROR] Could not find RPC registration class.');
        return;
    }

    const currentRpcClassProp = rpcClassProp as string;

    // Phase 2: Extract Mappings
    console.log(`\n[PHASE 2] Extracting Mappings using _.${currentRpcClassProp}...`);
    const astBar = multibar ? multibar.create(scriptContents.length, 0, { task: 'Extracting RPCs', foundStr: '| Mappings: 0' }) : null;
    const classSearchStr = `new _.${currentRpcClassProp}`;
    let processedCount = 0;

    for (const content of scriptContents) {
      // Yield to event loop to allow progress bar updates and prevent long hangs
      await new Promise(resolve => setImmediate(resolve));
      
      if (content.includes(classSearchStr)) {
        try {
          const ast = parseScript(content, { next: true });
          estraverse.traverse(ast as any, {
            enter: (node: any) => {
              if (node.type === 'NewExpression' &&
                  node.callee.type === 'MemberExpression' &&
                  node.callee.object.name === '_' &&
                  node.callee.property.name === currentRpcClassProp &&
                  node.arguments.length >= 3) {
                
                const rpcIdArg = node.arguments[0];
                const rpcArrayArg = node.arguments[2];

                if (rpcIdArg.type === 'Literal' && rpcArrayArg.type === 'ArrayExpression') {
                  for (const elem of rpcArrayArg.elements) {
                    if (elem && elem.type === 'Literal' && typeof elem.value === 'string' && 
                        elem.value.startsWith('/') && elem.value.includes('.')) {
                      mappings.set(String(rpcIdArg.value), elem.value.substring(1));
                      break;
                    }
                  }
                }
              }
            }
          });
        } catch (e) {
           // Skip malformed
        }
      }
      processedCount++;
      if (astBar) {
        astBar.increment(1, { foundStr: `| Mappings: ${mappings.size}` });
      } else if (processedCount % 50 === 0 || processedCount === scriptContents.length) {
        console.log(`[PROGRESS] Scanned chunk ${processedCount}/${scriptContents.length} | Found: ${mappings.size}`);
      }
    }

    if (multibar) multibar.stop();

    const outputLines = Array.from(mappings.entries())
      .map(([id, name]) => `${id}: ${name}`)
      .sort();

    const outputPath = path.join(process.cwd(), 'rpc_mappings.txt');
    fs.writeFileSync(outputPath, outputLines.join('\n'));
    
    console.log('\n' + '='.repeat(50));
    console.log(`Extraction Complete!`);
    console.log(`RPC Class: _.${rpcClassProp}`);
    console.log(`Unique RPCs: ${mappings.size}`);
    console.log(`Output: ${outputPath}`);
    console.log('='.repeat(50));
  } catch (err) {
    console.error('\n[FATAL ERROR] Scraping failed:', err instanceof Error ? err.message : String(err));
  }
}

const target = process.argv.find(arg => arg.startsWith('http'));
if (!target) {
    console.error('Usage: npm run scrape-rpc <url>');
    process.exit(1);
}

scrapeRpcMappings(target);
