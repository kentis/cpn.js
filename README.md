# @k1s/cpn-semantics

[![npm](https://img.shields.io/npm/v/@k1s/cpn-semantics)](https://www.npmjs.com/package/@k1s/cpn-semantics)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Pure **Coloured Petri Net (CPN)** simulation engine. Computes enabled bindings, fires transitions, and manages multiset token flow — with no UI, no app-specific types, and no side effects.

```bash
npm install @k1s/cpn-semantics
```

---

## Core Types

```ts
import type { Place, Transition, Arc, NetLike, Marking, Binding, Multiset } from '@k1s/cpn-semantics';
```

`NetLike` is intentionally structural and map-based:

```ts
type NetLike = {
  places: ReadonlyMap<string, Place>;
  transitions: ReadonlyMap<string, Transition>;
  arcs: ReadonlyMap<string, Arc>;
};

type Marking = ReadonlyMap<string, Multiset>; // placeId -> token multiset
type Binding = ReadonlyMap<string, string>;   // variable -> serialized token key
type Multiset = Map<string, number>;          // token key -> count
```

---

## Multiset Operations

```ts
import { msAdd, msSubtract, msScale, msContains, msIsEmpty, msEquals, EMPTY_MULTISET } from '@k1s/cpn-semantics';

const a: Multiset = new Map([['red', 2], ['blue', 1]]);
const b: Multiset = new Map([['red', 1]]);

msAdd(a, b);         // Map { red→3, blue→1 }
msSubtract(a, b);    // Map { red→1, blue→1 }
msScale(a, 2);       // Map { red→4, blue→2 }
msContains(a, b);    // true
msIsEmpty(a);        // false
msEquals(a, a);      // true
EMPTY_MULTISET;      // Map {}
```

---

## Simulation API

### `findEnabledBindings`

```ts
import { findEnabledBindings } from '@k1s/cpn-semantics';

const bindings: Binding[] = findEnabledBindings(
  net,         // NetLike
  marking,     // Marking
  transitionId, // string
  evalExpr,    // optional EvalExprFn
  evalGuard,   // optional EvalGuardFn
);
```

Returns all variable bindings under which the given transition is enabled.

### `computeEnabledSet`

```ts
import { computeEnabledSet } from '@k1s/cpn-semantics';

const enabled: ReadonlySet<string> =
  computeEnabledSet(net, marking, evalExpr, evalGuard);
```

Returns all transition IDs that are currently fireable.

### `fire`

```ts
import { fire } from '@k1s/cpn-semantics';

const newMarking: Marking = await fire(
  net,               // NetLike
  marking,           // Marking (immutable — returns new copy)
  transitionId,      // string
  binding,           // Binding
  evalExpr,          // optional EvalExprFn
  callbacks,         // optional FireCallbacks
);
```

Fires the given transition and returns the updated marking.

---

## SML Evaluation

SML expression and guard evaluation defaults to `@sosml/interpreter`.
`evalExprWithSosml` supports CPN multiset inscriptions such as `1\`x ++ 2\`(x + 1)` by evaluating the SML sub-expressions with SOSML.

```ts
import { evalExprWithSosml, evalGuardWithSosml } from '@k1s/cpn-semantics';

await evalExprWithSosml('1`x ++ 2`(x + 1)', 'sml', new Map([['x', '3']]));
await evalGuardWithSosml('x + 1 = 4', 'sml', new Map([['x', '3']]));
```

Python or other non-SML languages are still supplied by the host app through `EvalExprFn` and `EvalGuardFn`.

---

## Fire Callbacks

Use callbacks to observe or customize firing. The semantics package does not
interpret application-specific transition classes or arc extensions; layer those
behaviors in callbacks.

```ts
import type { FireCallbacks } from '@k1s/cpn-semantics';

const callbacks: FireCallbacks = {
  beforeFire: ({ transition, binding, marking, net }) => {
    // called before input tokens are consumed
  },
  midFire: async ({ transition, binding, marking, markingAfterConsume, net }) => {
    if (transition.id !== 'special-transition') return null;

    // Return Map<placeId, Multiset> to own output-side token placement.
    // null/undefined falls through to standard TP inscription evaluation.
    return new Map([['p_out', new Map([['done', 1]])]]);
  },
  afterFire: ({ transition, binding, markingAfterConsume, markingAfterFire, net }) => {
    // called after output tokens are added
  },
};

await fire(net, marking, transitionId, binding, evalExpr, callbacks);
```

---

## Classical Examples

The package includes executable examples under `examples/`. They are intentionally
not exported from the package API; they show how to build and run nets with the
public primitives.

Run all examples:

```bash
pnpm --filter @k1s/cpn-semantics run examples
```

Or build once and run an individual example:

```bash
pnpm --filter @k1s/cpn-semantics run build
node packages/cpn-semantics/examples/traffic-light.mjs
node packages/cpn-semantics/examples/producer-consumer.mjs
node packages/cpn-semantics/examples/sml-integration.mjs
```

### Traffic Light

One coloured token represents the current light state. Firing `advance` cycles
`red -> green -> yellow -> red`.

```bash
node packages/cpn-semantics/examples/traffic-light.mjs
```

### Bounded Producer-Consumer

This net models a bounded buffer with `slots`, `buffer`, and `consumed` places.
`produce` consumes one free slot and creates an `item`; `consume` consumes one
`item`, restores one slot, and records the consumed item.

```bash
node packages/cpn-semantics/examples/producer-consumer.mjs
```

### SML Guard + Expression

This net starts with integer tokens `2`, `3`, and `8`. The transition has an
SML guard `n mod 2 = 0`, so only even tokens are enabled. Its output inscription
is `1\`(n div 2)`, so firing computes the half of each even token.

```bash
node packages/cpn-semantics/examples/sml-integration.mjs
```

Each script prints JSON step output containing the fired transition, binding,
and marking snapshot after each firing.

---

## License

MIT © kentis — see [LICENSE](LICENSE)
