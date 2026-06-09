#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findEnabledBindings, fire } from '../dist/esm/index.js';
import { multiset, snapshotMarking } from './lib.mjs';

export function createSmlIntegrationExample() {
  const net = {
    places: new Map([
      ['numbers', { id: 'numbers' }],
      ['halves', { id: 'halves' }],
    ]),
    transitions: new Map([
      ['halveEven', {
        id: 'halveEven',
        guard: 'n mod 2 = 0',
        guardLang: 'sml',
      }],
    ]),
    arcs: new Map([
      ['number-to-halve-even', {
        id: 'number-to-halve-even',
        kind: 'PT',
        sourceId: 'numbers',
        targetId: 'halveEven',
        inscription: 'n',
        inscriptionLang: 'sml',
      }],
      ['halve-even-to-halves', {
        id: 'halve-even-to-halves',
        kind: 'TP',
        sourceId: 'halveEven',
        targetId: 'halves',
        inscription: '1`(n div 2)',
        inscriptionLang: 'sml',
      }],
    ]),
  };

  return {
    net,
    initialMarking: new Map([
      ['numbers', multiset([['2', 1], ['3', 1], ['8', 1]])],
      ['halves', new Map()],
    ]),
    transitionId: 'halveEven',
  };
}

export async function main() {
  const example = createSmlIntegrationExample();
  let marking = example.initialMarking;
  const steps = [];

  while (true) {
    const bindings = await findEnabledBindings(example.net, marking, example.transitionId);
    const binding = bindings[0];
    if (!binding) break;
    marking = await fire(example.net, marking, example.transitionId, binding);
    steps.push({
      transitionId: example.transitionId,
      binding: Object.fromEntries(binding),
      snapshot: snapshotMarking(marking),
    });
  }

  console.log(JSON.stringify(steps, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
