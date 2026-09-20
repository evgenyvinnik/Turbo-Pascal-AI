/** Print a source document using the browser's print service. */
export function printSource(name: string, source: string, highlight: boolean): void {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0';
  frame.title = `Print ${name}`;
  document.body.append(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }
  doc.title = name;
  const style = doc.createElement('style');
  style.textContent = '@page{margin:18mm}body{font:11pt monospace}h1{font:14pt monospace}pre{white-space:pre-wrap;tab-size:8}';
  doc.head.append(style);
  const title = doc.createElement('h1');
  title.textContent = name;
  const text = doc.createElement('pre');
  if (highlight) {
    for (const token of source.split(/(\b(?:program|uses|const|type|var|begin|end|procedure|function|if|then|else|for|to|downto|do|while|repeat|until|case|of|record|array|with|set)\b)/gi)) {
      const part = doc.createElement(/^(?:program|uses|const|type|var|begin|end|procedure|function|if|then|else|for|to|downto|do|while|repeat|until|case|of|record|array|with|set)$/i.test(token) ? 'b' : 'span');
      part.textContent = token;
      text.append(part);
    }
  } else text.textContent = source;
  doc.body.append(title, text);
  frame.contentWindow?.addEventListener('afterprint', () => { frame.remove(); }, { once: true });
  frame.contentWindow?.print();
}
