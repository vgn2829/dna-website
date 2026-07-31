// Express 5's types widened req.params[key] to `string | string[]` to reflect
// routes with repeating path segments (e.g. `/files/*splat`). None of this
// app's routes use repeating segments — every param here is a single named
// path token — so at runtime this is always a string; this narrows the type
// to match, documenting that invariant rather than casting it away silently.
export function param(value: string | string[]): string {
  if (Array.isArray(value)) {
    throw new Error('Expected a single path parameter, got an array');
  }
  return value;
}
