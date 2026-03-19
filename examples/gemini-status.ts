import { GoogleInternal } from '../src';

/**
 * Example: Checking Gemini User Status
 * 
 * To run this example:
 * 1. npx ts-node examples/gemini-status.ts
 * 
 * Note: You must provide your own SAPISID cookie and Origin for a live test.
 */
async function run() {
  const client = new GoogleInternal({
    cookies: '', // Add your SAPISID=... cookie here
    origin: 'https://gemini.google.com'
  });

  const gemini = client.registerService('gemini', {
    baseUrl: 'https://gemini.google.com/_/BardFrontendService/data/batchexecute',
    fields: ['1', '2'], // Using the new FieldMask feature
    checksum: true
  });

  // otAQ7b: BardFrontendService.GetUserStatus
  gemini.register('get_user_status', {
    rpcId: 'otAQ7b',
    mapArgs: () => [],
    mapResult: (arr) => ({
      isLoggedIn: !!arr[0],
      email: arr[1] || 'Unknown'
    })
  });

  try {
    console.log('Fetching Gemini user status...');
    const result = await gemini.execute('get_user_status', {});
    
    console.log('Result:', result);
    // @ts-ignore
    console.log('Payload Checksum:', result.__checksum);
  } catch (e) {
    console.error('Request failed. Ensure you have provided valid cookies.');
  }
}

run();
