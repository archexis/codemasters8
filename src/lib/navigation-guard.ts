const guards = new Set<(hash: string) => boolean>();

export function registerNavigationGuard(guard: (hash: string) => boolean): () => void {
  guards.add(guard);
  return () => { guards.delete(guard); };
}

/** Run before changing the rendered route, while form components still exist. */
export function canNavigate(hash: string): boolean {
  return [...guards].every(guard => guard(hash));
}
