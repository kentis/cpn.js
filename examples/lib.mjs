import { findEnabledBindings, fire } from '../dist/esm/index.js';

export function multiset(entries) {
  return new Map(entries);
}

export function snapshotMarking(marking) {
  return Object.fromEntries(
    [...marking].map(([placeId, tokens]) => [placeId, Object.fromEntries(tokens)]),
  );
}

export async function fireFirstEnabled(net, marking, transitionId) {
  const bindings = await findEnabledBindings(net, marking, transitionId);
  const binding = bindings[0];
  if (!binding) {
    throw new Error(`Transition "${transitionId}" is not enabled`);
  }
  return {
    binding,
    marking: await fire(net, marking, transitionId, binding),
  };
}

export async function runTransitionSequence(net, initialMarking, transitionIds) {
  let marking = initialMarking;
  const steps = [];

  for (const transitionId of transitionIds) {
    const result = await fireFirstEnabled(net, marking, transitionId);
    marking = result.marking;
    steps.push({
      transitionId,
      binding: Object.fromEntries(result.binding),
      snapshot: snapshotMarking(marking),
    });
  }

  return steps;
}
