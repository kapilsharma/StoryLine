/**
 * Words in a note, counted the way a writer means it (#194): the prose, not the
 * Markdown around it. `**She ran.**` is two words, a link counts by its text, an
 * image or a footnote marker counts as nothing.
 *
 * A word is a run of non-space characters with at least one letter or digit in
 * it — so "don't", "well-known" and "word—word" are one each, as a word
 * processor counts them, and a lone "—" or "*" is none.
 *
 * Pure and cheap (one pass of a few regexes): it runs on every keystroke, on
 * chapters of 10,000 words.
 */
export function countWords(markdown: string): number {
  const prose = markdown
    // Comments and HTML tags carry no prose.
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    // Images are pictures, not words.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    // Footnote references and definition markers: [^1], [^note]:
    .replace(/\[\^[^\]]+\]:?/g, ' ')
    // [text](url) and [[note-id|Label]] count by what the reader sees.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, ' $2 ')
    .replace(/\[\[([^\]]+)\]\]/g, ' $1 ')
    // List and quote markers at the start of a line ("1.", "-", "> 2)") are layout.
    .replace(/^[ \t]*(?:>[ \t]*)*(?:\d+[.)]|[-*+])[ \t]+/gm, ' ')
    // A bare URL is one thing to read past, not several words.
    .replace(/\bhttps?:\/\/\S+/g, ' url ')
  let words = 0
  for (const token of prose.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(token)) words++
  return words
}

/** "1 word", "1,234 words" — in the reader's own number format. */
export function formatWordCount(words: number): string {
  return `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}`
}
