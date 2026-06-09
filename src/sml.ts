import interpreter from '@sosml/interpreter';
import type { State, Values } from '@sosml/interpreter';

import type { Binding } from './types.js';

const { getFirstState, interpret } = interpreter;
type Value = Values.Value;

export class SmlEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmlEvaluationError';
  }
}

const RESULT_NAME = 'cpnResult';

function escapeSmlString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}

function tokenKeyToSmlLiteral(value: string): string {
  if (value === 'true' || value === 'false') return value;
  if (value === '()') return '()';
  if (/^-?\d+$/.test(value)) return value.replace(/^-/, '~');
  if (/^\(.*\)$/.test(value)) {
    return value.replace(/(^|[(,])-?\d+/g, (match) => match.replace('-', '~'));
  }
  return escapeSmlString(value);
}

function bindingPrelude(binding: Binding): string {
  return [...binding]
    .map(([name, value]) => `val ${name} = ${tokenKeyToSmlLiteral(value)};`)
    .join('\n');
}

function evaluateValue(expr: string, binding: Binding): { value: Value; state: State } {
  const source = `${bindingPrelude(binding)}\nval ${RESULT_NAME} = ${expr};`;
  const result = interpret(source, getFirstState(), { allowSuccessorML: true, allowVector: true });
  if (result.evaluationErrored) {
    throw new SmlEvaluationError(String(result.error ?? 'SML evaluation failed'));
  }

  const bindingValue = result.state.getDynamicValue(RESULT_NAME)?.[0];
  if (!bindingValue) {
    throw new SmlEvaluationError('SML evaluation did not produce a result');
  }
  return { value: bindingValue, state: result.state };
}

type SosmlValue = Value & {
  readonly value?: unknown;
  readonly entries?: Map<string, Value>;
};

function unquoteSmlString(value: string): string {
  return value
    .slice(1, -1)
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function valueToTokenKey(value: Value, state: State): string {
  const typed = value as SosmlValue;
  switch (value.typeName()) {
    case 'Integer':
      return String(typed.value);
    case 'BoolValue':
      return String(typed.value);
    case 'StringValue':
      return typeof typed.value === 'string' ? typed.value : unquoteSmlString(value.toString(state));
    case 'RecordValue': {
      const entries = typed.entries;
      if (!entries || entries.size === 0) return '()';
      const tupleItems: string[] = [];
      for (let i = 1; i <= entries.size; i += 1) {
        const item = entries.get(String(i));
        if (!item) break;
        tupleItems.push(valueToTokenKey(item, state));
      }
      if (tupleItems.length === entries.size && tupleItems.length > 0) {
        return `(${tupleItems.join(',')})`;
      }
      break;
    }
    default:
      break;
  }
  return value.toString(state);
}

function valueToBoolean(value: Value): boolean {
  if (value.typeName() !== 'BoolValue') {
    throw new SmlEvaluationError(`Guard must evaluate to bool, got ${value.typeName()}`);
  }
  return Boolean((value as SosmlValue).value);
}

function addToken(result: Map<string, number>, key: string, count: number): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new SmlEvaluationError(`Multiset count must be a non-negative integer, got ${count}`);
  }
  if (count === 0) return;
  result.set(key, (result.get(key) ?? 0) + count);
}

function splitTopLevelUnion(expr: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === '+' && expr[i + 1] === '+' && depth === 0) {
      parts.push(expr.slice(start, i).trim());
      start = i + 2;
      i += 1;
    }
  }

  parts.push(expr.slice(start).trim());
  return parts.filter(Boolean);
}

function splitMultisetTerm(term: string): { countExpr: string; valueExpr: string } | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < term.length; i += 1) {
    const ch = term[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === '`' && depth === 0) {
      return { countExpr: term.slice(0, i).trim(), valueExpr: term.slice(i + 1).trim() };
    }
  }
  return null;
}

export async function evalSmlExpression(
  expr: string,
  binding: Binding,
): Promise<Map<string, number>> {
  const trimmed = expr.trim();
  if (!trimmed || trimmed === 'empty') return new Map();

  const result = new Map<string, number>();
  for (const part of splitTopLevelUnion(trimmed)) {
    const term = splitMultisetTerm(part);
    if (!term) {
      const { value, state } = evaluateValue(part, binding);
      addToken(result, valueToTokenKey(value, state), 1);
      continue;
    }

    const countResult = evaluateValue(term.countExpr, binding);
    if (countResult.value.typeName() !== 'Integer') {
      throw new SmlEvaluationError(`Multiset count must evaluate to int, got ${countResult.value.typeName()}`);
    }
    const valueResult = evaluateValue(term.valueExpr, binding);
    addToken(
      result,
      valueToTokenKey(valueResult.value, valueResult.state),
      Number((countResult.value as SosmlValue).value),
    );
  }
  return result;
}

export async function evalSmlGuard(
  expr: string,
  binding: Binding,
): Promise<boolean> {
  if (!expr.trim()) return true;
  return valueToBoolean(evaluateValue(expr, binding).value);
}
