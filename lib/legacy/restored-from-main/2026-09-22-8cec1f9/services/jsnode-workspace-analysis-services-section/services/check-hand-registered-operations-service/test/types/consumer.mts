import { checkHandRegisteredOperations } from '@red-cup-engineering/check-hand-registered-operations-service';

async function inspect(catalogPath: string, baseline: number, options: {
  checkFn?: typeof checkHandRegisteredOperations;
} = {}) {
  const { checkFn = checkHandRegisteredOperations } = options;
  const result: Awaited<ReturnType<typeof checkHandRegisteredOperations>> = await checkFn({ catalogPath, baseline });
  const families: readonly string[] = result.families;
  const kind: 'check-hand-registered-operations' = result.kind;
  return { families, kind, ok: result.ok, count: result.count, baseline: result.baseline };
}
void inspect;
// @ts-expect-error baseline is required.
void checkHandRegisteredOperations({ catalogPath: 'catalog.mts' });
// @ts-expect-error baseline must be a number.
void checkHandRegisteredOperations({ catalogPath: 'catalog.mts', baseline: '1' });
