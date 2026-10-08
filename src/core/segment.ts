export interface TextRange { start: number; end: number; text: string }
const words = (s: string) => s.trim().split(/\s+/u).filter(Boolean).length;

/** Keep sentence boundaries where possible; exceptionally long sentences use clauses, then words. */
export function segmentText(text: string, maxWords = 40): TextRange[] {
  if (!Number.isInteger(maxWords) || maxWords < 15 || maxWords > 100) throw new Error('对照长度须在 15–100 词之间。');
  if (!text.trim()) return [];
  const sentences = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)];
  const ends: number[] = [];
  for (const sentence of sentences) {
    const s = sentence.segment;
    if (words(s) <= maxWords && s.length <= maxWords * 18) {
      ends.push(sentence.index + s.length);
      continue;
    }
    const tokens = [...s.matchAll(/\S+\s*/gu)];
    let first = 0;
    while (first < tokens.length) {
      let last = Math.min(first + maxWords, tokens.length);
      if (last < tokens.length) {
        for (let i = last - 1; i >= first + Math.floor(maxWords * .5); i--) {
          if (/[,;:—–.!?][”’"')\]]?\s*$/u.test(tokens[i][0])) { last = i + 1; break; }
        }
      }
      const token = tokens[last - 1];
      let end = sentence.index + (token.index ?? 0) + token[0].length;
      const from = ends.at(-1) ?? 0;
      // Also bound unspaced/CJK passages and very long URLs without losing characters.
      while (end - (ends.at(-1) ?? from) > maxWords * 18) {
        let cut = (ends.at(-1) ?? from) + maxWords * 18;
        if (/^[\uDC00-\uDFFF]$/.test(text[cut])) cut++;
        ends.push(cut);
      }
      ends.push(end);
      first = last;
    }
  }
  if (ends.at(-1) !== text.length) ends.push(text.length);
  const result: TextRange[] = [];
  let start = 0;
  for (const end of ends) {
    const part = text.slice(start, end);
    const previous = result.at(-1);
    if (previous && words(previous.text + part) <= maxWords && previous.text.length + part.length <= maxWords * 18) {
      previous.end = end;
      previous.text += part;
    } else if (part.trim()) result.push({ start, end, text: part });
    else if (previous) { previous.end = end; previous.text += part; }
    start = end;
  }
  return result;
}

/** Clone a text interval with its inline markup; empty elements are assigned exactly once. */
export function sliceInline(root: Element, start: number, end: number, seenIds: Set<string>): DocumentFragment {
  const doc = root.ownerDocument;
  const total = root.textContent?.length ?? 0;
  let cursor = 0;
  function visit(node: Node): Node | null {
    if (node.nodeType === 3) {
      const value = node.nodeValue ?? '';
      const from = cursor;
      cursor += value.length;
      const piece = value.slice(Math.max(0, start - from), Math.max(0, Math.min(value.length, end - from)));
      return piece ? doc.createTextNode(piece) : null;
    }
    if (node.nodeType !== 1) return null;
    const source = node as Element;
    const copy = source.cloneNode(false) as Element;
    const hasText = Boolean(source.textContent?.length);
    if (!hasText) {
      if (!(cursor >= start && (cursor < end || (cursor === end && end === total)))) return null;
      const full = source.cloneNode(true) as Element;
      cleanIds(full);
      return full;
    }
    for (const child of [...node.childNodes]) {
      const part = visit(child);
      if (part) copy.appendChild(part);
    }
    if (!copy.childNodes.length) return null;
    cleanId(copy);
    return copy;
  }
  function cleanId(el: Element) {
    const id = el.getAttribute('id');
    if (!id) return;
    if (seenIds.has(id)) el.removeAttribute('id'); else seenIds.add(id);
  }
  function cleanIds(el: Element) { cleanId(el); for (const child of el.querySelectorAll('[id]')) cleanId(child); }
  const fragment = doc.createDocumentFragment();
  for (const child of [...root.childNodes]) { const part = visit(child); if (part) fragment.appendChild(part); }
  return fragment;
}
