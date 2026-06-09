/**
 * Package-level unit tests for @k1s/cpn-semantics.
 * All imports use relative package paths (NOT @k1s/cpn-semantics self-ref).
 * All evalExpr / evalGuard are injected mocks — no Web Worker, no eval().
 */

import { describe, it, expect } from 'vitest';
import {
  EMPTY_MULTISET,
  msAdd,
  msSubtract,
  msContains,
  msIsEmpty,
  msEquals,
  msScale,
} from './multiset.js';
import { findEnabledBindings, fire, computeEnabledSet, evalExprWithSosml, evalGuardWithSosml } from './engine.js';
import type { NetLike } from './net-types.js';
import type { Marking, Binding } from './types.js';
import type { EvalExprFn, EvalGuardFn } from './engine.js';

// ── Mock eval functions ───────────────────────────────────────────────────────

/** Mock evalExpr: for single-variable inscription, returns 1 token of the bound value. */
const mockEvalExpr: EvalExprFn = async (
  _expr: string,
  _lang,
  binding: Binding,
): Promise<Map<string, number>> => {
  const firstVar = binding.keys().next().value;
  if (firstVar !== undefined) {
    const tokenKey = binding.get(firstVar)!;
    return new Map([[tokenKey, 1]]);
  }
  return new Map();
};

/** Mock evalGuard: always returns true. */
const mockEvalGuardTrue: EvalGuardFn = async () => true;

/** Mock evalGuard: always returns false. */
const mockEvalGuardFalse: EvalGuardFn = async () => false;

// ── Net fixture ───────────────────────────────────────────────────────────────

/**
 * 3-place, 2-transition CPN fixture:
 *   P1 →(x)→ T1 →(x)→ P2
 *   P3 →(y)→ T2 →(y)→ P2
 */
function makeFixtureNet(): NetLike {
  const places = new Map([
    ['P1', { id: 'P1', name: 'P1', colorSetId: '', initialMarking: '' }],
    ['P2', { id: 'P2', name: 'P2', colorSetId: '', initialMarking: '' }],
    ['P3', { id: 'P3', name: 'P3', colorSetId: '', initialMarking: '' }],
  ]);
  const transitions = new Map([
    ['T1', { id: 'T1', guard: '' }],
    ['T2', { id: 'T2', name: 'T2', guard: '' }],
  ]);
  const arcs = new Map([
    ['A1', { id: 'A1', kind: 'PT' as const, sourceId: 'P1', targetId: 'T1', inscription: 'x' }],
    ['A2', { id: 'A2', kind: 'TP' as const, sourceId: 'T1', targetId: 'P2', inscription: 'x' }],
    ['A3', { id: 'A3', kind: 'PT' as const, sourceId: 'P3', targetId: 'T2', inscription: 'y' }],
    ['A4', { id: 'A4', kind: 'TP' as const, sourceId: 'T2', targetId: 'P2', inscription: 'y' }],
  ]);
  return { places, transitions, arcs };
}

// ── Multiset ops ──────────────────────────────────────────────────────────────

describe('multiset ops', () => {
  it('msAdd sums counts for shared keys', () => {
    const a = new Map([['a', 1]]);
    const b = new Map([['a', 1], ['b', 2]]);
    const result = msAdd(a, b);
    expect(result.get('a')).toBe(2);
    expect(result.get('b')).toBe(2);
  });

  it('msSubtract removes consumed tokens', () => {
    const a = new Map([['a', 2]]);
    const b = new Map([['a', 1]]);
    const result = msSubtract(a, b);
    expect(result.get('a')).toBe(1);
  });

  it('msSubtract removes zero-count entries', () => {
    const a = new Map([['a', 1]]);
    const b = new Map([['a', 1]]);
    const result = msSubtract(a, b);
    expect(result.has('a')).toBe(false);
  });

  it('msSubtract throws on underflow', () => {
    const a = new Map([['a', 1]]);
    const b = new Map([['a', 2]]);
    expect(() => msSubtract(a, b)).toThrow(/underflow/i);
  });

  it('msContains returns true when b ⊆ a', () => {
    const a = new Map([['a', 2], ['b', 1]]);
    const b = new Map([['a', 1]]);
    expect(msContains(a, b)).toBe(true);
  });

  it('msContains returns false when a does not have enough tokens', () => {
    const a = new Map([['a', 1]]);
    const b = new Map([['a', 2]]);
    expect(msContains(a, b)).toBe(false);
  });

  it('msIsEmpty returns true for EMPTY_MULTISET', () => {
    expect(msIsEmpty(EMPTY_MULTISET)).toBe(true);
  });

  it('msIsEmpty returns false for non-empty multiset', () => {
    expect(msIsEmpty(new Map([['x', 1]]))).toBe(false);
  });

  it('msEquals returns true for equal multisets', () => {
    const a = new Map([['a', 1]]);
    const b = new Map([['a', 1]]);
    expect(msEquals(a, b)).toBe(true);
  });

  it('msEquals returns false for different multisets', () => {
    const a = new Map([['a', 1]]);
    const b = new Map([['a', 2]]);
    expect(msEquals(a, b)).toBe(false);
  });

  it('msScale multiplies all counts', () => {
    const ms = new Map([['a', 2]]);
    const result = msScale(ms, 3);
    expect(result.get('a')).toBe(6);
  });

  it('msScale with 0 returns empty multiset', () => {
    const ms = new Map([['a', 2]]);
    expect(msIsEmpty(msScale(ms, 0))).toBe(true);
  });
});

// ── findEnabledBindings ───────────────────────────────────────────────────────

describe('findEnabledBindings', () => {
  it('returns [{x→red}] when P1 has token "red"', async () => {
    const net = makeFixtureNet();
    const marking: Marking = new Map([['P1', new Map([['red', 1]])]]);
    const bindings = await findEnabledBindings(net, marking, 'T1', mockEvalExpr, mockEvalGuardTrue);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.get('x')).toBe('red');
  });

  it('returns empty array when marking is empty (no tokens)', async () => {
    const net = makeFixtureNet();
    const marking: Marking = new Map();
    const bindings = await findEnabledBindings(net, marking, 'T1', mockEvalExpr, mockEvalGuardTrue);
    expect(bindings).toHaveLength(0);
  });

  it('returns empty array when guard is false', async () => {
    // Use a net where T1 has a non-empty guard so evalGuard is actually called
    const places = new Map([
      ['P1', { id: 'P1', name: 'P1', colorSetId: '', initialMarking: '' }],
      ['P2', { id: 'P2', name: 'P2', colorSetId: '', initialMarking: '' }],
    ]);
    const transitions = new Map([
      ['T1', { id: 'T1', name: 'T1', guard: 'x > 0' }],
    ]);
    const arcs = new Map([
      ['A1', { id: 'A1', kind: 'PT' as const, sourceId: 'P1', targetId: 'T1', inscription: 'x' }],
      ['A2', { id: 'A2', kind: 'TP' as const, sourceId: 'T1', targetId: 'P2', inscription: 'x' }],
    ]);
    const netWithGuard: NetLike = { places, transitions, arcs };
    const marking: Marking = new Map([['P1', new Map([['red', 1]])]]);
    const bindings = await findEnabledBindings(netWithGuard, marking, 'T1', mockEvalExpr, mockEvalGuardFalse);
    expect(bindings).toHaveLength(0);
  });

  it('returns multiple bindings for multiple tokens in a place', async () => {
    const net = makeFixtureNet();
    const marking: Marking = new Map([['P1', new Map([['red', 1], ['blue', 1]])]]);
    const bindings = await findEnabledBindings(net, marking, 'T1', mockEvalExpr, mockEvalGuardTrue);
    expect(bindings).toHaveLength(2);
  });

  it('returns [] for unknown transitionId', async () => {
    const net = makeFixtureNet();
    const marking: Marking = new Map([['P1', new Map([['red', 1]])]]);
    const bindings = await findEnabledBindings(net, marking, 'TX_UNKNOWN', mockEvalExpr, mockEvalGuardTrue);
    expect(bindings).toHaveLength(0);
  });
});

// ── fire ──────────────────────────────────────────────────────────────────────

describe('fire', () => {
  it('moves token from P1 to P2 on fire', async () => {
    const net = makeFixtureNet();
    const marking: Marking = new Map([['P1', new Map([['red', 1]])]]);
    const binding: Binding = new Map([['x', 'red']]);
    const newMarking = await fire(net, marking, 'T1', binding, mockEvalExpr);
    expect(newMarking.get('P1')?.get('red') ?? 0).toBe(0);
    expect(newMarking.get('P2')?.get('red')).toBe(1);
  });

  it('returns a NEW Map (immutability: original not mutated)', async () => {
    const net = makeFixtureNet();
    const originalMarkingP1 = new Map([['red', 1]]);
    const marking: Marking = new Map([['P1', originalMarkingP1]]);
    const binding: Binding = new Map([['x', 'red']]);
    const newMarking = await fire(net, marking, 'T1', binding, mockEvalExpr);
    // Returned map must be a different reference
    expect(newMarking).not.toBe(marking);
    // Input marking must NOT be mutated
    expect(marking.get('P1')?.get('red')).toBe(1);
  });

  it('runs before, mid, and after fire callbacks in order', async () => {
    const net = makeFixtureNet();
    const marking: Marking = new Map([['P1', new Map([['red', 1]])]]);
    const binding: Binding = new Map([['x', 'red']]);
    const events: string[] = [];

    await fire(net, marking, 'T1', binding, mockEvalExpr, {
      beforeFire: () => {
        events.push('before');
      },
      midFire: () => {
        events.push('mid');
        return null;
      },
      afterFire: () => {
        events.push('after');
      },
    });

    expect(events).toEqual(['before', 'mid', 'after']);
  });

  it('midFire can provide custom output tokens', async () => {
    const net = makeFixtureNet();
    const marking: Marking = new Map([['P1', new Map([['red', 1]])]]);
    const binding: Binding = new Map([['x', 'red']]);

    const newMarking = await fire(net, marking, 'T1', binding, mockEvalExpr, {
      midFire: () => new Map([['P2', new Map([['custom', 1]])]]),
    });

    expect(newMarking.get('P2')?.get('custom')).toBe(1);
    expect(newMarking.get('P2')?.has('red')).toBe(false);
  });
});

describe('SOSML-backed SML evaluation', () => {
  it('evaluates guards with bindings', async () => {
    await expect(evalGuardWithSosml('x + 1 = 4', 'sml', new Map([['x', '3']]))).resolves.toBe(true);
  });

  it('evaluates multiset inscriptions with SML sub-expressions', async () => {
    const result = await evalExprWithSosml('1`x ++ 2`(x + 1)', 'sml', new Map([['x', '3']]));
    expect(result).toEqual(new Map([['3', 1], ['4', 2]]));
  });
});

// ── computeEnabledSet ────────────────────────────────────────────────────────

describe('computeEnabledSet', () => {
  it('T1 enabled when P1 has tokens, T2 disabled when P3 empty', async () => {
    const net = makeFixtureNet();
    const marking: Marking = new Map([['P1', new Map([['red', 1]])]]);
    const enabled = await computeEnabledSet(net, marking, mockEvalExpr, mockEvalGuardTrue);
    expect(enabled.has('T1')).toBe(true);
    expect(enabled.has('T2')).toBe(false);
  });

  it('returns empty set when no tokens anywhere', async () => {
    const net = makeFixtureNet();
    const marking: Marking = new Map();
    const enabled = await computeEnabledSet(net, marking, mockEvalExpr, mockEvalGuardTrue);
    expect(enabled.size).toBe(0);
  });

  it('returns both T1 and T2 enabled when both have tokens', async () => {
    const net = makeFixtureNet();
    const marking: Marking = new Map([
      ['P1', new Map([['red', 1]])],
      ['P3', new Map([['blue', 1]])],
    ]);
    const enabled = await computeEnabledSet(net, marking, mockEvalExpr, mockEvalGuardTrue);
    expect(enabled.has('T1')).toBe(true);
    expect(enabled.has('T2')).toBe(true);
  });
});
