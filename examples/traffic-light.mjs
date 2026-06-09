#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { multiset, runTransitionSequence } from './lib.mjs';

export function createTrafficLightExample() {
  const net = {
    places: new Map([
      ['state', { id: 'state' }],
    ]),
    transitions: new Map([
      ['advance', { id: 'advance', guard: '' }],
    ]),
    arcs: new Map([
      ['state-to-advance', {
        id: 'state-to-advance',
        kind: 'PT',
        sourceId: 'state',
        targetId: 'advance',
        inscription: 's',
      }],
      ['advance-to-state', {
        id: 'advance-to-state',
        kind: 'TP',
        sourceId: 'advance',
        targetId: 'state',
        inscription: 'if s = "red" then "green" else if s = "green" then "yellow" else "red"',
      }],
    ]),
  };

  return {
    net,
    initialMarking: new Map([
      ['state', multiset([['red', 1]])],
    ]),
    transitionId: 'advance',
  };
}

export async function main() {
  const example = createTrafficLightExample();
  const steps = await runTransitionSequence(
    example.net,
    example.initialMarking,
    Array.from({ length: 3 }, () => example.transitionId),
  );
  console.log(JSON.stringify(steps, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
