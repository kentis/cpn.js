/**
 * CPN Simulation Engine — pure async functions implementing Jensen Vol.1 enabling/firing semantics.
 *
 * SECURITY (LOCKED-05): No eval(), new Function(), or Function() in this file.
 */

import type { Arc, Place, Transition, NetLike } from './net-types.js';
import { msContains, msSubtract, msAdd, EMPTY_MULTISET } from './multiset.js';
import type { Marking, Binding } from './types.js';
import { evalSmlExpression, evalSmlGuard } from './sml.js';

/**
 * The evaluation function injected by simulationCommands.ts.
 * For arc expressions: returns a Multiset (Map<string, number>).
 */
export type EvalExprFn = (
  expr: string,
  lang: 'sml' | 'python',
  binding: Binding,
) => Promise<Map<string, number>>;

export type EvalGuardFn = (
  expr: string,
  lang: 'sml' | 'python',
  binding: Binding,
) => Promise<boolean>;

/**
 * Lifecycle callbacks for simulation firing.
 * `midFire` runs after input tokens are removed and before output tokens are added.
 * Returning a Map from `midFire` lets an application provide custom output tokens
 * for a transition; returning null/undefined keeps standard TP inscription semantics.
 */
export type FireCallbackContext = {
  readonly transition: Transition;
  readonly binding: Binding;
  readonly marking: Marking;
  readonly net: NetLike;
};

export type MidFireCallbackContext = FireCallbackContext & {
  readonly markingAfterConsume: Marking;
};

export type AfterFireCallbackContext = FireCallbackContext & {
  readonly markingAfterConsume: Marking;
  readonly markingAfterFire: Marking;
};

export type CustomTransitionOutput = Map<string, Map<string, number>>;

export type FireCallbacks = {
  readonly beforeFire?: (ctx: FireCallbackContext) => Promise<void> | void;
  readonly midFire?: (
    ctx: MidFireCallbackContext,
  ) => Promise<CustomTransitionOutput | null | undefined> | CustomTransitionOutput | null | undefined;
  readonly afterFire?: (ctx: AfterFireCallbackContext) => Promise<void> | void;
};

export const evalExprWithSosml: EvalExprFn = async (expr, lang, binding) => {
  if (lang !== 'sml') {
    throw new Error(`No ${lang} expression evaluator is configured in @k1s/cpn-semantics`);
  }
  return evalSmlExpression(expr, binding);
};

export const evalGuardWithSosml: EvalGuardFn = async (expr, lang, binding) => {
  if (lang !== 'sml') {
    throw new Error(`No ${lang} guard evaluator is configured in @k1s/cpn-semantics`);
  }
  return evalSmlGuard(expr, binding);
};

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Extract variable names from an inscription expression.
 * Phase 3 simple heuristic: scan for IDENT tokens (sequences of [a-zA-Z_][a-zA-Z0-9_']*)
 * that are not CPN ML keywords. Returns deduplicated variable names.
 */
function extractVariables(expr: string): string[] {
  const KEYWORDS = new Set([
    'let', 'val', 'in', 'end', 'if', 'then', 'else',
    'andalso', 'orelse', 'not', 'div', 'mod', 'true', 'false', 'empty',
  ]);
  const matches = expr.match(/[a-zA-Z_][a-zA-Z0-9_']*/g) ?? [];
  return [...new Set(matches)].filter((m) => !KEYWORDS.has(m));
}

/**
 * Build candidate bindings for a single PT arc.
 * Strategy (per LOCKED-05 and RESEARCH.md §Binding Enumeration):
 * - Constant inscription (no free variables): one candidate = empty partial binding
 * - Single variable x: one candidate per distinct token key in source place marking
 * - Multiple variables: Cartesian product of all token keys in source marking
 *
 * Returns array of partial Binding maps for this arc's variables.
 */
function buildArcCandidates(
  arc: Arc,
  marking: Marking,
): Map<string, string>[] {
  const sourceMarking = marking.get(arc.sourceId) ?? EMPTY_MULTISET;
  const tokenKeys = [...sourceMarking.keys()];

  if (arc.inscription.trim() === '') {
    // No inscription — arc has weight 1 (implicit), treat as constant
    return [new Map()];
  }

  const vars = extractVariables(arc.inscription);
  if (vars.length === 0) {
    // Constant inscription — no variables to bind
    return [new Map()];
  }

  if (vars.length === 1) {
    // Single variable — one candidate per token in source place
    return tokenKeys.map((key) => new Map([[vars[0]!, key]]));
  }

  // Multiple variables — Cartesian product of tokenKeys for each variable
  // Complexity: O(k^n) where k=distinct tokens, n=variables — bounded per RESEARCH.md
  let candidates: Map<string, string>[] = [new Map()];
  for (const varName of vars) {
    const next: Map<string, string>[] = [];
    for (const candidate of candidates) {
      for (const key of tokenKeys) {
        // Skip if variable already bound to a different value (consistency)
        if (candidate.has(varName) && candidate.get(varName) !== key) continue;
        const extended = new Map(candidate);
        extended.set(varName, key);
        next.push(extended);
      }
    }
    candidates = next;
  }
  return candidates;
}

/**
 * Merge partial binding maps from multiple arcs.
 * Returns only consistent combinations (same variable → same value).
 * Produces Cartesian product of per-arc candidates filtered for consistency.
 */
function mergeBindings(
  perArcCandidates: Map<string, string>[][],
): Binding[] {
  let combined: Map<string, string>[] = [new Map()];
  for (const arcCandidates of perArcCandidates) {
    const next: Map<string, string>[] = [];
    for (const existing of combined) {
      for (const arcCandidate of arcCandidates) {
        // Check consistency: if both maps have the same key, values must match
        let consistent = true;
        for (const [k, v] of arcCandidate) {
          if (existing.has(k) && existing.get(k) !== v) { consistent = false; break; }
        }
        if (!consistent) continue;
        next.push(new Map([...existing, ...arcCandidate]));
      }
    }
    combined = next;
  }
  return combined;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Find all bindings under which transition `transitionId` is enabled.
 *
 * A binding b enables t iff:
 *   1. ∀ PT-arc a to t: E(a)(b) ⊆ M(source(a))  (arc inscription submultiset)
 *   2. G(t)(b) = true  (guard evaluates to true)
 *
 * (Jensen Vol.1, Chapter 2, Definition 2.6)
 */
export async function findEnabledBindings(
  net: NetLike,
  marking: Marking,
  transitionId: string,
  evalExpr: EvalExprFn = evalExprWithSosml,
  evalGuard: EvalGuardFn = evalGuardWithSosml,
): Promise<Binding[]> {
  const transition = net.transitions.get(transitionId);
  if (!transition) return [];

  const ptArcs = [...net.arcs.values()].filter(
    (a) => a.kind === 'PT' && a.targetId === transitionId,
  );

  if (ptArcs.length === 0) {
    // No input arcs — check guard only; binding is empty
    const b: Binding = new Map();
    if (transition.guard.trim()) {
      const lang = transition.guardLang ?? 'sml';
      const guardOk = await evalGuard(transition.guard, lang, b);
      return guardOk ? [b] : [];
    }
    return [b];
  }

  // Build per-arc candidates and merge
  const perArcCandidates = ptArcs.map((arc) => buildArcCandidates(arc, marking));
  const candidateBindings = mergeBindings(perArcCandidates);

  // Filter: check arc expressions satisfied AND guard passes
  const enabled: Binding[] = [];
  await Promise.all(
    candidateBindings.map(async (b) => {
      // Check all PT arc expression weights are covered by the marking
      const arcChecks = ptArcs.map(async (arc) => {
        const lang = arc.inscriptionLang ?? 'sml';
        const inscription = arc.inscription.trim();
        if (!inscription) return true; // empty inscription = no token consumed
        const weight = await evalExpr(inscription, lang, b);
        const available = marking.get(arc.sourceId) ?? EMPTY_MULTISET;
        return msContains(available, weight);
      });
      const arcResults = await Promise.all(arcChecks);
      if (arcResults.some((ok) => !ok)) return;

      // Check guard
      if (transition.guard.trim()) {
        const lang = transition.guardLang ?? 'sml';
        const guardOk = await evalGuard(transition.guard, lang, b);
        if (!guardOk) return;
      }
      enabled.push(b);
    }),
  );
  return enabled;
}

/**
 * Fire transition `transitionId` under binding `b`, returning the updated marking.
 * Assumes (transitionId, b) is enabled — throws if a place would underflow.
 */
export async function fire(
  net: NetLike,
  marking: Marking,
  transitionId: string,
  binding: Binding,
  evalExpr: EvalExprFn = evalExprWithSosml,
  callbacks: FireCallbacks = {},
): Promise<Marking> {
  // Start from a mutable copy; replace reference for immutability
  const newMarking = new Map(marking);

  const transition = net.transitions.get(transitionId);
  if (!transition) return newMarking;

  await callbacks.beforeFire?.({ transition, binding, marking, net });

  // Remove tokens consumed by PT arcs.
  for (const arc of net.arcs.values()) {
    if (arc.kind !== 'PT' || arc.targetId !== transitionId) continue;
    if (arc.readArcGroupId) continue;
    const inscription = arc.inscription.trim();
    if (!inscription) continue;
    const lang = arc.inscriptionLang ?? 'sml';
    const weight = await evalExpr(inscription, lang, binding);
    const current = newMarking.get(arc.sourceId) ?? EMPTY_MULTISET;
    newMarking.set(arc.sourceId, msSubtract(current, weight));
  }

  // Add tokens produced by TP arcs, unless midFire supplies custom output tokens.
  const markingAfterConsume = new Map(newMarking);
  const customResult = await callbacks.midFire?.({
    transition,
    binding,
    marking,
    markingAfterConsume,
    net,
  });
  if (customResult !== null && customResult !== undefined) {
    for (const [placeId, tokens] of customResult) {
      const current = newMarking.get(placeId) ?? EMPTY_MULTISET;
      newMarking.set(placeId, msAdd(current, tokens));
    }
    await callbacks.afterFire?.({
      transition,
      binding,
      marking,
      markingAfterConsume,
      markingAfterFire: newMarking,
      net,
    });
    return newMarking;
  }

  // Standard CPN path: evaluate TP arc inscriptions via evalExpr
  for (const arc of net.arcs.values()) {
    if (arc.kind !== 'TP' || arc.sourceId !== transitionId) continue;
    if (arc.readArcGroupId) continue;
    const inscription = arc.inscription.trim();
    if (!inscription) continue;
    const lang = arc.inscriptionLang ?? 'sml';
    const weight = await evalExpr(inscription, lang, binding);
    const current = newMarking.get(arc.targetId) ?? EMPTY_MULTISET;
    newMarking.set(arc.targetId, msAdd(current, weight));
  }

  await callbacks.afterFire?.({
    transition,
    binding,
    marking,
    markingAfterConsume,
    markingAfterFire: newMarking,
    net,
  });
  return newMarking;
}

/**
 * Compute the set of all currently enabled transition IDs.
 * Used after every step to update simulationStore.enabledTransitions.
 */
export async function computeEnabledSet(
  net: NetLike,
  marking: Marking,
  evalExpr: EvalExprFn = evalExprWithSosml,
  evalGuard: EvalGuardFn = evalGuardWithSosml,
): Promise<ReadonlySet<string>> {
  const enabled = new Set<string>();
  // Parallel evaluation — all transitions checked concurrently
  await Promise.all(
    [...net.transitions.keys()].map(async (tId) => {
      const bindings = await findEnabledBindings(net, marking, tId, evalExpr, evalGuard);
      if (bindings.length > 0) enabled.add(tId);
    }),
  );
  return enabled;
}
