import { expect } from 'vitest';

/** Matches a thrown error that has at least these fields. Vitest types
 * expect.objectContaining as `any`, while toThrow and toThrowError take an Error. */
export const errorWith = (fields: Record<string, unknown>): Error =>
  expect.objectContaining(fields) as Error;
