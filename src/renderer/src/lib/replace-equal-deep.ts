/**
 * Structural sharing (the technique behind TanStack Query's `replaceEqualDeep`):
 * returns `next`, but with every part that is deep-equal to the matching part of
 * `prev` replaced by that part of `prev` - and `prev` itself when nothing differs.
 *
 * Recurses into plain objects and arrays; everything else (primitives, functions,
 * class instances) compares by `===`. Lets identity checks downstream (React's
 * bail-outs, `memo`, React Flow's node adoption) treat unchanged data as unchanged.
 */
export function replaceEqualDeep<T>(prev: T, next: T): T {
  if (prev === next) {
    return prev
  }

  if (Array.isArray(prev) && Array.isArray(next)) {
    const shared = next.map((item, index) => replaceEqualDeep(prev[index], item))
    const unchanged =
      prev.length === shared.length && shared.every((item, index) => item === prev[index])
    return (unchanged ? prev : shared) as T
  }

  if (isPlainObject(prev) && isPlainObject(next)) {
    const prevKeys = Object.keys(prev)
    const shared: Record<string, unknown> = {}
    let unchanged = prevKeys.length === Object.keys(next).length
    for (const key of Object.keys(next)) {
      shared[key] = replaceEqualDeep(prev[key], next[key])
      unchanged &&= key in prev && shared[key] === prev[key]
    }
    return (unchanged ? prev : shared) as T
  }

  return next
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
