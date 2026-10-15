// Isolated test supplier boundary. This is not a production bootstrap bypass.
import { readFile, mkdir } from 'node:fs/promises';
import { nativeMetadataPass, inspectNativeMirrors } from '../../src/native-registry-metadata-provider.mjs';
const [file, mode] = process.argv.slice(2);
const input = JSON.parse(await readFile(file, 'utf8'));
try {
  if (mode === 'acquire') await mkdir(input.cacheDir);
  const files = mode === 'offline' ? await inspectNativeMirrors(input.cacheDir, input.records) : undefined;
  const result = await nativeMetadataPass({ ...input, offline: mode === 'offline' });
  process.stdout.write(JSON.stringify({ ...result, files }) + '\n');
} catch (error) {
  process.stderr.write((error?.name === 'MetadataInputRefusal' ? error.code : 'native-test-refused') + '\n');
  process.exitCode = 1; // Allow native asynchronous persistence to settle naturally.
}
