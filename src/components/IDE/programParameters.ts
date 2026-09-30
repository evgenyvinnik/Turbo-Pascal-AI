/** DOS-style argument entry: double quotes group spaces, and backslashes
 * remain literal path separators. An open quote takes the remaining text. */
export function parseProgramParameters(text: string): string[] {
  const arguments_: string[] = [];
  let value = '',
    quoted = false,
    started = false;
  for (const character of text) {
    if (character === '"') {
      quoted = !quoted;
      started = true;
    } else if (/\s/.test(character) && !quoted) {
      if (started) arguments_.push(value);
      value = '';
      started = false;
    } else {
      value += character;
      started = true;
    }
  }
  if (started) arguments_.push(value);
  return arguments_;
}
