export interface GrepMatch {
  file: string;
  line: number;
  column: number;
  text: string;
}
export interface GrepQuery {
  pattern: string;
  masks: string[];
  ignoreCase: boolean;
  invert: boolean;
}

/** Grep arguments are parsed locally; no shell or external program is invoked. */
export function parseGrepArguments(argumentsText: string): GrepQuery {
  const tokens: string[] = [];
  let current = '',
    quote = '',
    tokenStarted = false;
  for (const char of argumentsText) {
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      tokenStarted = true;
    } else if (/\s/.test(char)) {
      if (tokenStarted) {
        tokens.push(current);
        current = '';
        tokenStarted = false;
      }
    } else {
      current += char;
      tokenStarted = true;
    }
  }
  if (quote) throw new Error('Unclosed quote in program arguments');
  if (tokenStarted) tokens.push(current);
  let ignoreCase = false,
    invert = false;
  while (tokens[0]?.startsWith('-')) {
    const option = tokens.shift() ?? '';
    if (option === '--') break;
    for (const flag of option.slice(1)) {
      if (flag === 'i') ignoreCase = true;
      else if (flag === 'v') invert = true;
      else if (flag !== 'n') throw new Error(`Unsupported Grep option: -${flag}`);
    }
  }
  const pattern = tokens.shift();
  if (pattern === undefined || !pattern.length)
    throw new Error('Enter a search pattern and file mask, for example program *.pas');
  return { pattern, masks: tokens.length ? tokens : ['*.PAS'], ignoreCase, invert };
}

export function searchGrepFiles(files: Record<string, string>, query: GrepQuery): GrepMatch[] {
  let pattern: RegExp;
  try {
    pattern = new RegExp(query.pattern, query.ignoreCase ? 'i' : '');
  } catch {
    throw new Error('Invalid Grep regular expression');
  }
  const masks = query.masks.map((mask) => {
    const path = mask
      .replace(/^[a-z]:/i, '')
      .replaceAll('\\', '/')
      .replace(/^\/+/, '');
    return {
      directory: path.includes('/'),
      regex: new RegExp(
        `^${path
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replaceAll('*', '.*')
          .replaceAll('?', '.')}$`,
        'i'
      ),
    };
  });
  const results: GrepMatch[] = [];
  for (const [file, source] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const path = file.replaceAll('\\', '/'),
      basename = path.split('/').at(-1) ?? path;
    if (!masks.some((mask) => mask.regex.test(mask.directory ? path : basename))) continue;
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const text = lines[index] ?? '',
        match = pattern.exec(text);
      if (query.invert ? !match : Boolean(match))
        results.push({ file, line: index + 1, column: (match?.index ?? 0) + 1, text });
      if (results.length === 5000) return results;
    }
  }
  return results;
}
