const PUNCTUATION = ['。', '！', '？', '，', '；', '.', '!', '?', ',', ';'];

export function limitAnswer(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, '').trim();
  if (clean.length <= maxChars) return clean;

  const window = clean.slice(0, maxChars);
  let cut = -1;
  for (let i = window.length - 1; i >= 0; i--) {
    if (PUNCTUATION.includes(window[i])) {
      cut = i;
      break;
    }
  }
  const body = cut >= 0 ? window.slice(0, cut + 1) : window;
  return `${body}…`;
}
