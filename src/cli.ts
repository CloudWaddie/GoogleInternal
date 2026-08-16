#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { scrapeRpcMappings } from './scraper';

async function main(): Promise<void> {
  const target = process.argv.find(arg => arg.startsWith('http'));
  if (!target) {
    console.error('Usage: npx @cloudwaddie/googleinternal scrape-rpc <url>');
    process.exit(1);
  }

  const { mappings, mappingTypes } = await scrapeRpcMappings(target);

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
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});