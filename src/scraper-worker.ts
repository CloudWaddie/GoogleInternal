import { parentPort } from 'worker_threads';
import { extractMappingsFromChunk } from './extract';

// Work-stealing protocol: main thread sends {type:'chunk', index, content};
// worker replies {type:'result', index, entries} per chunk, or {type:'done'}
// when the main thread has exhausted the queue and asks it to shut down.
parentPort!.on('message', (msg: any) => {
  if (msg.type === 'done') {
    parentPort!.postMessage({ type: 'done' });
    return;
  }
  const { entries, classTypes } = extractMappingsFromChunk(msg.content);
  parentPort!.postMessage({ type: 'result', index: msg.index, entries, classTypes });
});
