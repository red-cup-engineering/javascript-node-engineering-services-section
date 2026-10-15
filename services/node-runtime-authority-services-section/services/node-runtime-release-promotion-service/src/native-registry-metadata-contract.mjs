// Build-input contract only. Native PNPM owns version, registry and policy semantics.
import { createHash } from 'node:crypto';
import { delimiter, isAbsolute } from 'node:path';
export const METADATA_OWNER = '@red-cup-engineering/node-runtime-release-promotion-service';
export const METADATA_STAGE = 'build-input';
export const METADATA_SCHEMA = 'native-pnpm-registry-metadata/v1';
export const PNPM_VERSION = '11.28.5';

export class MetadataInputRefusal extends Error {
  constructor(code) { super(code); this.name = 'MetadataInputRefusal'; this.code = code; }
}
export function requireInput(condition, code) {
  if (!condition) throw new MetadataInputRefusal(code);
}
export function assertOwnerStage(manifest, stage, cohort) {
  requireInput(manifest.name === METADATA_OWNER, 'metadata-owner-mismatch');
  requireInput(stage === METADATA_STAGE, 'metadata-stage-mismatch');
  requireInput(cohort.packageManager === 'pnpm@' + PNPM_VERSION && cohort.suppliers.length === 11,
    'metadata-cohort-mismatch');
  requireInput(new Set(cohort.suppliers.map(s => s.name)).size === cohort.suppliers.length, 'metadata-cohort-mismatch');
  for (const supplier of cohort.suppliers) {
    requireInput(manifest.devDependencies?.[supplier.name] === supplier.version, 'metadata-cohort-declaration-mismatch');
    requireInput(!manifest.dependencies?.[supplier.name] && !manifest.optionalDependencies?.[supplier.name], 'metadata-supplier-is-runtime-dependency');
  }
}

const populated = value => value != null && (Array.isArray(value) ? value.length > 0 :
  typeof value === 'object' ? Object.keys(value).length > 0 : Boolean(value));
function hasTokenHelper(value, visited = new Set()) {
  if (value == null || typeof value !== 'object' || visited.has(value)) return false;
  visited.add(value);
  return Object.entries(value).some(([key, child]) =>
    (key.replace(/[-_]/gu, '').toLowerCase().endsWith('tokenhelper') && child != null) || hasTokenHelper(child, visited));
}
/** Must precede createResolver, createFetchFromRegistry and createGetAuthHeaderByURI. */
export function assertNonExecutingConfig(config, context = {}) {
  requireInput(!hasTokenHelper(config), 'metadata-token-helper-unreceived');
  requireInput(!populated(config.configDependencies), 'metadata-config-dependencies-unreceived');
  requireInput(!populated(config.globalPnpmfile), 'metadata-global-pnpmfile-unreceived');
  requireInput(!populated(config.customResolvers) && !populated(config.customFetchers) &&
    !populated(config.hooks) && !populated(context.hooks), 'metadata-hooks-unreceived');
  const pnpmfiles = config.pnpmfile == null ? [] : [config.pnpmfile].flat();
  requireInput(pnpmfiles.every(path => ['.pnpmfile.cjs', '.pnpmfile.mjs'].includes(path)), 'metadata-pnpmfile-unreceived');
}

/** The CLI may switch/download before even --version. This owner admits only
 * the already-selected exact package manager and current Node interpreter. */
export function assertNoToolchainSwitch(config, context, rootManifest, persistsLockfile) {
  requireInput(rootManifest.packageManager === 'pnpm@' + PNPM_VERSION, 'metadata-root-package-manager-mismatch');
  const wanted = context.wantedPackageManager;
  requireInput(wanted?.name === 'pnpm' && wanted.version === PNPM_VERSION && !wanted.fromDevEngines &&
    !wanted.hash && !persistsLockfile, 'metadata-package-manager-switch-unreceived');
  for (const manifest of [rootManifest, context.rootProjectManifest, context.enginePinManifest]) {
    requireInput(!populated(manifest?.devEngines?.packageManager) && !populated(manifest?.devEngines?.runtime) &&
      !populated(manifest?.engines?.runtime), 'metadata-runtime-switch-unreceived');
  }
  requireInput(!populated(config.useNodeVersion) && !populated(config.executionEnv) &&
    !populated(context.nodeVersionFromEnginesRuntime), 'metadata-runtime-switch-unreceived');
}

/** Diagnostic receiving assertion only: a caller must reject unsupported launch
 * controls before starting this owner, because a preload would already have run. */
export function assertNormalInvocation(execArgv, env) {
  requireInput(execArgv.length === 0, 'metadata-node-arguments-unreceived');
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_PRESERVE_SYMLINKS']) {
    requireInput(!env[key]?.trim(), 'metadata-node-environment-unreceived');
  }
}

/** The unchanged CLI reader uses workspace cwd. Relative/empty PATH entries
 * would make an earlier owner-cwd observation name a different interpreter. */
export function assertInterpreterSearchPath(value) {
  requireInput(typeof value === 'string' && value.length > 0, 'metadata-interpreter-search-unreceived');
  const paths = value.split(delimiter);
  requireInput(paths.every(path => path.length > 0 && isAbsolute(path)), 'metadata-interpreter-search-unreceived');
  return paths;
}

/** Only explicit non-secret values cross the receipt boundary. */
export function nonSecretPolicy(config, constants) {
  const identity = {};
  for (const key of ['minimumReleaseAge', 'minimumReleaseAgeStrict', 'minimumReleaseAgeExclude',
    'minimumReleaseAgeIgnoreMissingTime', 'trustPolicy', 'trustPolicyExclude', 'trustPolicyIgnoreAfter',
    'registrySupportsTimeField', 'resolutionMode', 'allowBuilds']) {
    if (config[key] !== undefined) identity[key] = config[key];
  }
  const endpoint = value => {
    const url = new URL(value);
    requireInput(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password &&
      !url.search && !url.hash, 'metadata-credential-bearing-registry-unreceived');
    return url.href;
  };
  const bytesHash = value => value == null ? null : createHash('sha256')
    .update(JSON.stringify(Array.isArray(value) ? value : [value])).digest('hex');
  const proxy = value => {
    if (value == null || value === false || value === '') return value ?? null;
    const url = new URL(value);
    requireInput(!url.search && !url.hash, 'metadata-proxy-shape-unreceived');
    url.username = ''; url.password = ''; return url.href;
  };
  const tls = value => ({ caSha256: bytesHash(value?.ca), certSha256: bytesHash(value?.cert),
    clientKeyConfigured: value?.key != null, strictSsl: value?.strictSsl ?? true });
  identity.transport = { ...tls(config), httpProxy: proxy(config.httpProxy), httpsProxy: proxy(config.httpsProxy),
    noProxy: config.noProxy ?? null, localAddress: config.localAddress ?? null,
    maxSockets: config.maxSockets ?? null, fetchTimeout: config.fetchTimeout ?? null,
    fetchRetries: config.fetchRetries ?? null, fetchRetryFactor: config.fetchRetryFactor ?? null,
    fetchRetryMintimeout: config.fetchRetryMintimeout ?? null, fetchRetryMaxtimeout: config.fetchRetryMaxtimeout ?? null,
    fetchWarnTimeoutMs: config.fetchWarnTimeoutMs ?? null, fetchMinSpeedKiBps: config.fetchMinSpeedKiBps ?? null };
  identity.registriesByScope = Object.fromEntries(Object.entries(config.registriesByScope).sort()
    .map(([name, value]) => [name, endpoint(value)]));
  identity.registriesByPrefix = Object.fromEntries(Object.entries({ ...constants.BUILTIN_REGISTRIES_BY_PREFIX,
    ...config.registriesByPrefix }).sort().map(([name, value]) => [name, endpoint(value)]));
  // Native transport receives the original in-memory config, never this projection.
  identity.registryServers = Object.fromEntries(Object.entries(config.configByUri ?? {}).sort().map(([uri, value]) => {
    const safe = {};
    for (const key of ['serverType', 'supportsTimeField', 'strictSsl']) if (value[key] !== undefined) safe[key] = value[key];
    if (value.tls) safe.tls = tls(value.tls);
    return [uri === '' ? '<default>' : endpoint(uri.startsWith('//') ? 'https:' + uri : uri), safe];
  }));
  return identity;
}

export function assertNativeResolution(record, result) {
  requireInput(result?.manifest?.name === record.entry.name && result.manifest.version === record.entry.version,
    'metadata-selected-version-mismatch');
  requireInput(result.resolution?.integrity === record.resolution.integrity,
    'metadata-selected-integrity-mismatch');
  requireInput((result.resolution?.revision ?? 0) === (record.resolution.revision ?? 0),
    'metadata-selected-revision-mismatch');
  // PNPM's verifier remains the URL-equivalence oracle. No house URL parser substitutes for it.
}
