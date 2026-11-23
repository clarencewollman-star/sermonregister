import catalog from "./luther-1912-catalog.json";

export type BibleBook = (typeof catalog)[number];
export type BibleVerse = [number, string];
export type BibleChapters = Record<string, BibleVerse[]>;
export type BiblePassage = {
  book: BibleBook;
  chapter: number;
  firstVerse?: number;
  lastVerse?: number;
};

export const bibleBooks = catalog;

const additionalNames: Record<number, string[]> = {
  1: ["Genesis", "Gen"],
  2: ["Exodus", "Ex"],
  3: ["Leviticus", "Lev"],
  4: ["Numbers", "Num"],
  5: ["Deuteronomy", "Deut"],
  7: ["Judges"],
  8: ["Ruth"],
  11: ["1 Kings"],
  12: ["2 Kings"],
  13: ["1 Chronicles"],
  14: ["2 Chronicles"],
  15: ["Ezra"],
  16: ["Nehemiah"],
  17: ["Esther"],
  18: ["Job"],
  19: ["Psalms", "Psalmen"],
  20: ["Proverbs", "Prov"],
  21: ["Ecclesiastes", "Eccl"],
  22: ["Song of Solomon", "Song of Songs"],
  23: ["Isaiah", "Isa"],
  24: ["Jeremiah"],
  25: ["Lamentations"],
  26: ["Ezekiel"],
  32: ["Jonah"],
  33: ["Micah"],
  38: ["Zechariah"],
  39: ["Malachi"],
  40: ["Matthew", "Mat", "Matt", "Matth", "Matthaeus"],
  41: ["Mark", "Mrk"],
  42: ["Luke", "Luc"],
  43: ["John", "Jn"],
  44: ["Acts"],
  45: ["Romans", "Rom", "Roemer"],
  46: ["1 Corinthians", "1 Cor"],
  47: ["2 Corinthians", "2 Cor"],
  48: ["Galatians"],
  49: ["Ephesians"],
  50: ["Philippians"],
  51: ["Colossians", "Colosser", "Col"],
  52: ["1 Thessalonians", "1 Thess"],
  53: ["2 Thessalonians", "2 Thess"],
  54: ["1 Timothy"],
  55: ["2 Timothy"],
  57: ["Philem"],
  58: ["Hebrews", "Heb", "Hebraeer"],
  59: ["James"],
  60: ["1 Peter", "1 Pet"],
  61: ["2 Peter", "2 Pet"],
  62: ["1 John", "1 Jn", "1 Joh"],
  63: ["2 John", "2 Jn", "2 Joh"],
  64: ["3 John", "3 Jn", "3 Joh"],
  65: ["Jude"],
  66: ["Revelation", "Rev"],
  67: ["Judith"],
  68: ["Wisdom"],
  69: ["Tobit", "Tobias"],
  70: ["Ecclesiasticus", "Jesus Sirach"],
  72: ["1 Maccabees"],
  73: ["2 Maccabees"],
};

function normalizeBookName(name: string) {
  return name.normalize("NFD").replace(/[^\p{L}\d]/gu, "").toLowerCase();
}

const booksByName = new Map<string, BibleBook>();
for (const book of bibleBooks) {
  for (const name of [book.name, book.short, ...(additionalNames[book.id] ?? [])]) {
    booksByName.set(normalizeBookName(name), book);
  }
}

export function findBiblePassage(reference: string, title: string): BiblePassage | null {
  for (const value of [reference, title]) {
    for (const line of value.normalize("NFC").split(/[\r\n;]/)) {
      const match = line.trim().match(
        /^((?:[1-5]\.?\s*)?\p{L}+(?:[ \t]+\p{L}+)*)\.?\s*(\d+)(?![\d\p{L}])(?:(?:\s*[:,.]\s*|\s+)(\d+)(?:\s*(?:[-–—]|bis)\s*(\d+)(\s*[:,]\s*\d+)?)?)?/iu,
      );
      if (!match) continue;
      const [, name, chapterNumber, first, last, crossChapter] = match;
      const book = booksByName.get(normalizeBookName(name));
      const chapter = Number(chapterNumber);
      if (!book?.chapters.includes(chapter)) continue;
      return {
        book,
        chapter,
        firstVerse: first ? Number(first) : undefined,
        lastVerse: crossChapter ? undefined : Number(last ?? first) || undefined,
      };
    }
  }
  return null;
}

export function selectPassageVerses(verses: BibleVerse[], passage: BiblePassage) {
  const { firstVerse, lastVerse } = passage;
  if (firstVerse === undefined || lastVerse === undefined || lastVerse < firstVerse) return [];
  const start = verses.findIndex(([number]) => number === firstVerse);
  const end = verses.findLastIndex(([number]) => number === lastVerse);
  if (start < 0 || end < start) return [];
  // A repeated number in the source makes that end of the quoted range ambiguous.
  if (start !== verses.findLastIndex(([number]) => number === firstVerse) ||
      end !== verses.findIndex(([number]) => number === lastVerse)) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function bibleVerseText(source: string) {
  return source.replace(/[»«]/g, "").normalize("NFC");
}

export function formatCopiedVerses(passage: BiblePassage, verses: BibleVerse[]) {
  const ranges: Array<{ first: number; last: number }> = [];
  for (const [number] of verses) {
    const previous = ranges.at(-1);
    if (previous && (number === previous.last || number === previous.last + 1)) {
      previous.last = number;
    } else {
      ranges.push({ first: number, last: number });
    }
  }
  const citation = ranges.map(({ first, last }) => first === last ? first : `${first}–${last}`).join(", ");
  return [
    ...verses.map(([number, source]) => `${number} ${bibleVerseText(source)}`),
    `${passage.book.name} ${passage.chapter}:${citation}`,
  ].join("\n");
}
