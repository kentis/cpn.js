import type { Multiset } from './multiset.js';

/**
 * Marking — current token distribution across all places.
 * Immutable: a new Map is created on every step (not mutated in place).
 */
export type Marking = ReadonlyMap<string, Multiset>;

/**
 * Binding — assignment of colour values (serialised as token-key strings)
 * to transition variables found in arc inscriptions and guards.
 * Key = variable name, Value = token key string (e.g. '3', 'red', '(1,2)').
 */
export type Binding = ReadonlyMap<string, string>;
