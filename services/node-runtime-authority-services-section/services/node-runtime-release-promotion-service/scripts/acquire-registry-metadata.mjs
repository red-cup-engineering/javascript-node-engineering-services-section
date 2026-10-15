// Source-only build-stage entrance. Intentionally absent from package exports/bin.
import { acquireNativeMetadataInput, prepareNativeMetadataInput, receiveNativeMetadataInput } from '../src/native-registry-metadata-input.mjs';
import { requireInput } from '../src/native-registry-metadata-contract.mjs';

try {
  const [mode, ...args] = process.argv.slice(2), options = {};
  requireInput(['prepare', 'acquire', 'receive', 'verify'].includes(mode), 'metadata-mode-invalid');
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.slice(2);
    requireInput(['workspace', 'pnpm', 'output', 'stage', 'identity'].includes(key) && args[index].startsWith('--') &&
      args[index + 1] && !Object.hasOwn(options, key), 'metadata-arguments-invalid');
    options[key] = args[index + 1];
  }
  requireInput(['workspace', 'pnpm', 'output', 'stage'].every(key => options[key]), 'metadata-arguments-missing');
  const result = mode === 'prepare' ? await prepareNativeMetadataInput(options) : mode === 'acquire'
    ? await acquireNativeMetadataInput(options) : await receiveNativeMetadataInput(options, { verifyOnly: mode === 'verify' });
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  // Native transport/configuration errors may carry credentials or raw config.
  // Only this owner's closed refusal codes cross stdout/stderr. No cause/stack.
  const code = error?.name === 'MetadataInputRefusal' && /^metadata-[a-z-]+$/u.test(error.code)
    ? error.code : 'metadata-native-operation-refused';
  process.stderr.write(code + '\n');
  process.exitCode = 1;
}
