/**
 * Multiset — a Map from serialized token value (string) to count (positive integer).
 * Used for CPN token markings and arc annotations.
 * Keys are arbitrary strings (JSON-serialized token values).
 *
 * Security note (T-01-03-01): Map is used (not plain object) so that keys like
 * `__proto__` are safe — Map key identity is value-based and does not interact
 * with the prototype chain.
 */
export type Multiset = ReadonlyMap<string, number>;

/** The empty multiset. Reuse this constant — don't create `new Map()` everywhere. */
export const EMPTY_MULTISET: Multiset = new Map();

// ─── Multiset arithmetic ──────────────────────────────────────────────────────

/**
 * Union with summed counts: a + b.
 * Result contains every token from both; counts are summed for shared tokens.
 */
export function msAdd(a: Multiset, b: Multiset): Multiset {
  const result = new Map(a);
  for (const [k, v] of b) {
    result.set(k, (result.get(k) ?? 0) + v);
  }
  return result;
}

/**
 * Multiset difference: a - b.
 * Tokens with count reaching 0 are removed from the result.
 *
 * THROWS if any token in b has a higher count than in a (underflow).
 * This enforces the CPN enabling condition (T-01-03-04): a transition can only
 * fire if the arc weight is a submultiset of the current place marking.
 * Callers must verify `msContains(marking, arcWeight)` before calling this.
 */
export function msSubtract(a: Multiset, b: Multiset): Multiset {
  const result = new Map(a);
  for (const [k, v] of b) {
    const have = result.get(k) ?? 0;
    const count = have - v;
    if (count < 0) {
      throw new Error(`Multiset underflow for token "${k}": need ${v}, have ${have}`);
    }
    if (count === 0) {
      result.delete(k);
    } else {
      result.set(k, count);
    }
  }
  return result;
}

/**
 * Scalar multiplication: ms * n.
 * n must be a non-negative integer. n=0 returns EMPTY_MULTISET.
 * Used for arc weight expressions (e.g. 2`token means count 2 of token).
 */
export function msScale(ms: Multiset, n: number): Multiset {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`msScale: n must be a non-negative integer, got ${n}`);
  }
  if (n === 0) return EMPTY_MULTISET;
  const result = new Map<string, number>();
  for (const [k, v] of ms) {
    result.set(k, v * n);
  }
  return result;
}

/**
 * Submultiset check: b ⊆ a.
 * Returns true iff every token in b appears in a with at least the same count.
 * Used for the CPN enabling check (arc weight ⊆ current marking).
 */
export function msContains(a: Multiset, b: Multiset): boolean {
  for (const [k, v] of b) {
    if ((a.get(k) ?? 0) < v) return false;
  }
  return true;
}

/** Returns true iff the multiset has no tokens. */
export function msIsEmpty(ms: Multiset): boolean {
  return ms.size === 0;
}

/**
 * Structural equality: a == b.
 * Two multisets are equal iff they have identical keys and counts.
 */
export function msEquals(a: Multiset, b: Multiset): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}
