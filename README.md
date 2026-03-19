# GoogleInternal

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)

A Node.js/TypeScript library designed to simplify interaction with Google's internal `batchexecute` RPC protocol. It handles complex authentication (SAPISIDHASH), declarative spec mapping, and batching.

## Features

- **Spec Registry:** Map obfuscated Google RPC IDs to friendly JSON objects with Zod validation.
- **Auth Module:** Automatic `SAPISIDHASH` generation and cookie parsing.
- **Transport Layer:** Handles XSSI prefix stripping, length-prefixed chunking, and double-JSON encoding.
- **Batching:** Send multiple RPCs across different services in a single POST request.
- **Streaming:** Support for length-prefixed streaming responses.
- **RPC Scraper:** Automatically extract RPC mappings from any Google application by parsing AST structures.

## Usage

### 1. Initialize the Client

The client holds global configuration like cookies and the request origin, which are used to generate the required `SAPISIDHASH` headers.

```typescript
import { GoogleInternal } from './src';

const client = new GoogleInternal({
  cookies: 'SAPISID=...; HSID=...; SID=...;',
  origin: 'https://docs.google.com'
});
```

### 2. Define Services and Specs

A **Service** represents a specific Google endpoint (e.g., Drive, Docs).
A **Spec** defines how a specific RPC call within that service works:
- `rpcId`: The obfuscated 6-character ID (e.g., `zx9ptd`).
- `schema` (optional): A Zod schema to validate and type-safe the input data.
- `mapArgs`: A function that transforms the validated data into the raw array format Google expects.
- `mapResult`: A function that transforms the raw array response back into a friendly object.

```typescript
import { z } from 'zod';

// 1. Register the service
const drive = client.registerService('drive', {
  baseUrl: 'https://docs.google.com/_/DrivePicker/data/batchexecute'
});

// 2. Define the input schema
const ListFilesSchema = z.object({
  folderId: z.string().default('root'),
  pageSize: z.number().max(100).default(50)
});

// 3. Register the RPC spec
drive.register('list_files', {
  rpcId: 'zx9ptd',
  schema: ListFilesSchema,
  mapArgs: (data) => [data.folderId, data.pageSize],
  mapResult: (arr) => ({
    files: arr[0].map((f: any) => ({ id: f[0], name: f[1] }))
  })
});
```

### 3. Execute Calls

Once registered, you can call services by name. The input will be validated against the Zod schema before being sent.

```typescript
// Call via the service instance
const { files } = await drive.execute('list_files', { folderId: 'root' });

// Or call via the client
const driveService = client.service('drive');
const result = await driveService.execute('list_files', { pageSize: 10 });
```

## Scraping RPC Mappings

You can automatically extract RPC IDs and their corresponding service methods from any Google application that uses `batchexecute`.

```bash
npm run scrape-rpc <app-url>
```

**Example:**
```bash
npm run scrape-rpc https://gemini.google.com/app
```

The script will:
1. Fetch the application's base JavaScript.
2. Dynamically discover and download all registered modules.
3. Perform a 2-phase AST analysis to identify the RPC registration class and extract all mapping definitions.
4. Output a sorted `rpc_mappings.txt` file.

## Credits

Special thanks to [bedros-p](https://github.com/bedros-p) for sharing the foundational knowledge on Google's module fetching system and for the core logic used in the RPC registration class discovery.

## License

MIT
