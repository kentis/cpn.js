#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { multiset, runTransitionSequence } from './lib.mjs';

export function createProducerConsumerExample(bufferCapacity = 2) {
  if (!Number.isInteger(bufferCapacity) || bufferCapacity < 1) {
    throw new RangeError(`bufferCapacity must be a positive integer, got ${bufferCapacity}`);
  }

  const net = {
    places: new Map([
      ['slots', { id: 'slots' }],
      ['buffer', { id: 'buffer' }],
      ['consumed', { id: 'consumed' }],
    ]),
    transitions: new Map([
      ['produce', { id: 'produce', guard: '' }],
      ['consume', { id: 'consume', guard: '' }],
    ]),
    arcs: new Map([
      ['slot-to-produce', {
        id: 'slot-to-produce',
        kind: 'PT',
        sourceId: 'slots',
        targetId: 'produce',
        inscription: 'slot',
      }],
      ['produce-to-buffer', {
        id: 'produce-to-buffer',
        kind: 'TP',
        sourceId: 'produce',
        targetId: 'buffer',
        inscription: '1`"item"',
      }],
      ['buffer-to-consume', {
        id: 'buffer-to-consume',
        kind: 'PT',
        sourceId: 'buffer',
        targetId: 'consume',
        inscription: 'item',
      }],
      ['consume-to-slots', {
        id: 'consume-to-slots',
        kind: 'TP',
        sourceId: 'consume',
        targetId: 'slots',
        inscription: '1`()',
      }],
      ['consume-to-consumed', {
        id: 'consume-to-consumed',
        kind: 'TP',
        sourceId: 'consume',
        targetId: 'consumed',
        inscription: 'item',
      }],
    ]),
  };

  return {
    net,
    initialMarking: new Map([
      ['slots', multiset([['()', bufferCapacity]])],
      ['buffer', new Map()],
      ['consumed', new Map()],
    ]),
  };
}

export async function main() {
  const example = createProducerConsumerExample(2);
  const steps = await runTransitionSequence(
    example.net,
    example.initialMarking,
    ['produce', 'produce', 'consume', 'produce', 'consume'],
  );
  console.log(JSON.stringify(steps, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
