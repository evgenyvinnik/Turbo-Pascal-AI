import { CP437, glyphCode } from '../tui/vgaFont';

/** Pascal strings contain DOS bytes; browser strings contain Unicode text. */
export function encodeDosText(text: string): string {
  let result = '';
  for (const char of text)
    result += String.fromCharCode(char.charCodeAt(0) < 128 ? char.charCodeAt(0) : glyphCode(char));
  return result;
}

export function decodeDosText(text: string): string {
  let result = '';
  for (const char of text)
    result += /[\r\n\t\b]/.test(char) ? char : (CP437[char.charCodeAt(0)] ?? '?');
  return result;
}
