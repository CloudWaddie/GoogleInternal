# GoogleInternal

A Node.js/TypeScript library designed to simplify interaction with Google's internal `batchexecute` RPC protocol. It handles complex authentication (SAPISIDHASH), declarative spec mapping, and batching.

## Features

- **Spec Registry:** Map obfuscated Google RPC IDs to friendly JSON objects.
- **Auth Module:** Automatic `SAPISIDHASH` generation and cookie parsing.
- **Transport Layer:** Handles XSSI prefix stripping, length-prefixed chunking, and double-JSON encoding.
- **Batching:** Send multiple RPCs across different services in a single POST request.

## Usage

### 1. Initialize the Client

```typescript
import { GoogleInternal } from './src'; // Use from source until published

const client = new GoogleInternal({
  cookies: 'SAPISID=...; HSID=...; SID=...;',
  origin: 'https://docs.google.com'
});
```

### 2. Register a Service and Specs

```typescript
const drive = client.registerService('drive', {
  baseUrl: 'https://docs.google.com/_/DrivePicker/data/batchexecute'
});

drive.register('list_files', {
  rpcId: 'zx9ptd',
  mapArgs: (data) => [data.folderId, 100],
  mapResult: (arr) => ({
    files: arr[0].map(f => ({ id: f[0], name: f[1] }))
  })
});
```

### 3. Execute Calls

```typescript
const { files } = await drive.execute('list_files', { folderId: 'root' });
```

### 4. Batch Execution

```typescript
const batch = client.newBatch();

batch.add('drive', 'list_files', { folderId: 'root' });
batch.add('other_service', 'other_spec', { data: '...' });

const [filesResult, otherResult] = await batch.execute();
```

## License

MIT
