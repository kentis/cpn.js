import { describe, expect, it } from 'vitest';
import { findEnabledBindings, fire } from './index.js';
// @ts-expect-error executable examples are intentionally outside the package type surface
import { runTransitionSequence, snapshotMarking } from '../examples/lib.mjs';
// @ts-expect-error executable examples are intentionally outside the package type surface
import { createTrafficLightExample } from '../examples/traffic-light.mjs';
// @ts-expect-error executable examples are intentionally outside the package type surface
import { createProducerConsumerExample } from '../examples/producer-consumer.mjs';
// @ts-expect-error executable examples are intentionally outside the package type surface
import { createSmlIntegrationExample } from '../examples/sml-integration.mjs';

describe('executable CPN examples', () => {
  it('traffic-light.mjs cycles red -> green -> yellow -> red', async () => {
    const example = createTrafficLightExample();
    const steps = await runTransitionSequence(
      example.net,
      example.initialMarking,
      Array.from({ length: 3 }, () => example.transitionId),
    ) as Array<{ snapshot: Record<string, unknown> }>;

    expect(steps.map((step) => step.snapshot.state)).toEqual([
      { green: 1 },
      { yellow: 1 },
      { red: 1 },
    ]);
  });

  it('producer-consumer.mjs respects bounded buffer slots', async () => {
    const example = createProducerConsumerExample(2);
    const steps = await runTransitionSequence(
      example.net,
      example.initialMarking,
      ['produce', 'produce', 'consume', 'produce', 'consume'],
    ) as Array<{ snapshot: Record<string, unknown> }>;

    expect(steps.map((step) => step.snapshot)).toEqual([
      { slots: { '()': 1 }, buffer: { item: 1 }, consumed: {} },
      { slots: {}, buffer: { item: 2 }, consumed: {} },
      { slots: { '()': 1 }, buffer: { item: 1 }, consumed: { item: 1 } },
      { slots: {}, buffer: { item: 2 }, consumed: { item: 1 } },
      { slots: { '()': 1 }, buffer: { item: 1 }, consumed: { item: 2 } },
    ]);
  });

  it('producer is disabled when the bounded buffer is full', async () => {
    const example = createProducerConsumerExample(1);

    const firstProduce = await findEnabledBindings(example.net, example.initialMarking, 'produce');
    expect(firstProduce).toHaveLength(1);

    const fullMarking = await fire(example.net, example.initialMarking, 'produce', firstProduce[0]!);
    const secondProduce = await findEnabledBindings(example.net, fullMarking, 'produce');

    expect(snapshotMarking(fullMarking)).toEqual({
      slots: {},
      buffer: { item: 1 },
      consumed: {},
    });
    expect(secondProduce).toHaveLength(0);
  });

  it('sml-integration.mjs uses SML guard and output inscription', async () => {
    const example = createSmlIntegrationExample();
    let marking = example.initialMarking;
    const steps = [];

    while (true) {
      const bindings = await findEnabledBindings(example.net, marking, example.transitionId);
      const binding = bindings[0];
      if (!binding) break;
      marking = await fire(example.net, marking, example.transitionId, binding);
      steps.push({
        binding,
        snapshot: snapshotMarking(marking),
      });
    }

    expect(steps.map((step) => step.binding.get('n'))).toEqual(['2', '8']);
    expect(steps.at(-1)?.snapshot).toEqual({
      numbers: { '3': 1 },
      halves: { '1': 1, '4': 1 },
    });
  });
});
