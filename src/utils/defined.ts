/**
 * A value the code before has made certain, such as an element of an array
 * whose length was just checked, or a regular expression's group that the
 * expression always fills. Where `value!` would only claim it, this checks:
 * an internal error names what was missing rather than letting `undefined`
 * flow on.
 */
export function defined<T>(value: T, what = 'value'): NonNullable<T> {
  if (value === undefined || value === null) throw new Error(`Internal error: no ${what}`);
  return value;
}
