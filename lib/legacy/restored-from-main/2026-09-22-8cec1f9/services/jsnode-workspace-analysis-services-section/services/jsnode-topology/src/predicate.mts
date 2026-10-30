export function predicate(name: string): () => string {
  return () => `jsnode.${name}`;
}
