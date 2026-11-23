"use client";

import { type ReactNode, type Ref, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  bibleBooks,
  bibleVerseText,
  formatCopiedVerses,
  selectPassageVerses,
  type BibleBook,
  type BibleChapters,
  type BiblePassage,
  type BibleVerse,
} from "../bible/luther1912";

const firstBook = bibleBooks[0];
const firstChapter = { book: firstBook, chapter: firstBook.chapters[0] };
const sourceUrl = "https://sourceforge.net/projects/zefania-sharp/files/Bibles/GER/Lutherbibel/Luther%201912%20-%20mit%20Apokryphen/";
const bookSections = [
  { id: "ot", label: "Altes Testament" },
  { id: "ap", label: "Apokryphen" },
  { id: "nt", label: "Neues Testament" },
].map((section) => ({ ...section, books: bibleBooks.filter((book) => book.section === section.id) }));
const orderedBooks = bookSections.flatMap((section) => section.books);

type BookLoad = {
  id: number;
  attempt: number;
  chapters: BibleChapters | null;
};

function adjacentChapter(passage: BiblePassage, step: -1 | 1): BiblePassage | null {
  const { book, chapter } = passage;
  const nextChapter = book.chapters[book.chapters.indexOf(chapter) + step];
  if (nextChapter !== undefined) return { book, chapter: nextChapter };
  const nextBook = orderedBooks[orderedBooks.indexOf(book) + step];
  if (!nextBook) return null;
  return {
    book: nextBook,
    chapter: step === 1 ? nextBook.chapters[0] : nextBook.chapters[nextBook.chapters.length - 1],
  };
}

function BibleDialog({ title, children, onClose, returnLabel, pickerHeading }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  returnLabel?: string;
  pickerHeading?: Ref<HTMLHeadingElement>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={`bible-dialog p-0 ${pickerHeading ? "bible-picker-dialog border" : "border-0"}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="modal-content h-100">
        <div className="modal-header gap-2">
          {returnLabel && (
            <button type="button" className="btn btn-outline-primary bible-return-button" onClick={onClose}>
              <i className="bi bi-arrow-left me-1" aria-hidden="true" /> {returnLabel}
            </button>
          )}
          <h2 className="modal-title fs-5" id={titleId} ref={pickerHeading} tabIndex={pickerHeading ? -1 : undefined}>{title}</h2>
          {!returnLabel && (
            <button type="button" className="btn-close" aria-label="Close Book And Chapter Picker" onClick={onClose} />
          )}
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </dialog>
  );
}

function BiblePicker({ current, onChoose, onClose }: {
  current: BiblePassage;
  onChoose: (passage: BiblePassage) => void;
  onClose?: () => void;
}) {
  const [book, setBook] = useState<BibleBook | null>(null);
  const pickerHeading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const bookButtons = useRef(new Map<number, HTMLButtonElement>());
  const returnToBook = useRef<number | null>(null);

  useEffect(() => {
    if (!book && returnToBook.current !== null) {
      bookButtons.current.get(returnToBook.current)?.focus();
    } else {
      content.current?.closest(".modal-body")?.scrollTo({ top: 0 });
      pickerHeading.current?.focus({ preventScroll: true });
    }
  }, [book]);

  const title = book ? `${book.name} · Choose A Chapter` : "Choose A Book";
  const pickerBody = (
    <div ref={content} className="bible-picker-content">
      {book ? (
        <>
          <button type="button" className="btn btn-outline-secondary mb-3" onClick={() => setBook(null)}>
            <i className="bi bi-arrow-left me-1" aria-hidden="true" /> All Books
          </button>
          <div className="bible-picker-grid">
            {book.chapters.map((chapter) => (
              <button
                type="button"
                key={chapter}
                className="btn btn-outline-secondary"
                aria-label={`Chapter ${chapter}`}
                aria-current={book === current.book && chapter === current.chapter ? "location" : undefined}
                onClick={() => onChoose({ book, chapter })}
              >{chapter}</button>
            ))}
          </div>
        </>
      ) : bookSections.map(({ id, label, books }) => (
        <section key={id} lang="de">
          <h3 className="h6 mb-2">{label}</h3>
          <div className="bible-picker-grid bible-book-picker" data-section={id}>
            {books.map((candidate) => (
              <button
                type="button"
                key={candidate.id}
                ref={(node) => {
                  if (node) bookButtons.current.set(candidate.id, node);
                  else bookButtons.current.delete(candidate.id);
                }}
                className="btn btn-outline-secondary"
                title={candidate.name}
                aria-label={candidate.name}
                aria-current={candidate === current.book ? "location" : undefined}
                onClick={() => {
                  returnToBook.current = candidate.id;
                  setBook(candidate);
                }}
              >{candidate.short}</button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );

  if (onClose) {
    return (
      <BibleDialog title={title} onClose={onClose} pickerHeading={pickerHeading}>
        {pickerBody}
      </BibleDialog>
    );
  }

  return (
    <div className="bible-reader bible-picker-inline">
      <h2 className="h5 mb-3" ref={pickerHeading} tabIndex={-1}>{title}</h2>
      {pickerBody}
    </div>
  );
}

function VerseList({ passage, verses }: { passage: BiblePassage; verses: BibleVerse[] }) {
  const [selected, setSelected] = useState(() => selectPassageVerses(verses, passage));
  const [copyStatus, setCopyStatus] = useState<"" | "copied" | "manual">("");
  const anchor = useRef<HTMLButtonElement>(null);
  const manualCopy = useRef<HTMLTextAreaElement>(null);
  const copyAttempt = useRef(0);
  const anchorIndex = verses.findIndex(([number]) => number === passage.firstVerse);
  const selectedVerses = verses.filter((_, index) => selected.includes(index));
  const copyText = formatCopiedVerses(passage, selectedVerses);

  useEffect(() => {
    anchor.current?.scrollIntoView({ block: "nearest" });
  }, []);

  useEffect(() => {
    if (copyStatus === "manual") {
      manualCopy.current?.select();
    } else if (copyStatus === "copied") {
      const timer = window.setTimeout(() => setCopyStatus(""), 1800);
      return () => window.clearTimeout(timer);
    }
  }, [copyStatus]);

  function changeSelection(next: number[]) {
    setSelected(next);
    setCopyStatus("");
    copyAttempt.current += 1;
  }

  async function copyVerses(button: HTMLButtonElement) {
    const attempt = ++copyAttempt.current;
    try {
      await navigator.clipboard.writeText(copyText);
      if (attempt === copyAttempt.current) setCopyStatus("copied");
    } catch {
      if (attempt !== copyAttempt.current) return;
      const field = document.createElement("textarea");
      field.value = copyText;
      field.className = "visually-hidden";
      field.readOnly = true;
      (button.closest("dialog") ?? document.body).append(field);
      field.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        // The visible copy field is the fallback when clipboard access is unavailable.
      } finally {
        field.remove();
        button.focus({ preventScroll: true });
      }
      setCopyStatus(copied ? "copied" : "manual");
    }
  }

  const showSelection = selected.length > 0;
  return (
    <div className={showSelection ? "bible-verses-have-selection" : undefined}>
      <div className="list-group list-group-flush" lang="de" aria-label={`${passage.book.name} ${passage.chapter}`}>
        {verses.map(([number, source], index) => {
          const pressed = selected.includes(index);
          return (
            <button
              type="button"
              ref={index === anchorIndex ? anchor : undefined}
              key={index}
              className={`list-group-item list-group-item-action bible-verse${pressed ? " list-group-item-primary" : ""}`}
              aria-pressed={pressed}
              onClick={() => changeSelection(pressed ? selected.filter((item) => item !== index) : [...selected, index])}
            >
              <span className="bible-verse-number">{number}</span>
              <span>{bibleVerseText(source)}</span>
              <i className={`bi ${pressed ? "bi-check2" : ""}`} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {showSelection && (
        <div className="bible-selection-bar bg-body border-top shadow-sm">
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
            <span className="small fw-semibold" role="status">
              {copyStatus === "copied" ? "Copied" : `${selected.length} ${selected.length === 1 ? "Verse" : "Verses"} Selected`}
            </span>
            <div className="d-flex align-items-center gap-2">
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => changeSelection([])}>Clear</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={(event) => void copyVerses(event.currentTarget)}>
                <i className="bi bi-clipboard me-1" aria-hidden="true" /> Copy Verses
              </button>
            </div>
          </div>
          {copyStatus === "manual" && (
            <div className="bible-copy-manual mt-2">
              <label className="form-label small">
                Use Your Device’s Copy Command
                <textarea className="form-control" ref={manualCopy} readOnly rows={3} value={copyText} />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BibleReader({ initialPassage = null, inEditor = false }: {
  initialPassage?: BiblePassage | null;
  inEditor?: boolean;
}) {
  const [passage, setPassage] = useState(initialPassage ?? firstChapter);
  const [picking, setPicking] = useState<"initial" | "picker" | null>(
    inEditor && initialPassage === null ? "initial" : null,
  );
  const [bookLoad, setBookLoad] = useState<BookLoad | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [chapterVisit, setChapterVisit] = useState(0);
  const toolbar = useRef<HTMLDivElement>(null);
  const currentBook = passage.book.id;
  const shouldRead = picking !== "initial";

  useEffect(() => {
    if (!shouldRead) return;
    const controller = new AbortController();
    async function loadBook() {
      try {
        const response = await fetch(`/bible/luther-1912/${currentBook}.json`, { signal: controller.signal });
        if (!response.ok) throw new Error("Could Not Load The Book");
        const chapters = await response.json() as BibleChapters;
        if (!controller.signal.aborted) setBookLoad({ id: currentBook, attempt, chapters });
      } catch {
        if (!controller.signal.aborted) setBookLoad({ id: currentBook, attempt, chapters: null });
      }
    }
    void loadBook();
    return () => controller.abort();
  }, [currentBook, attempt, shouldRead]);

  useEffect(() => {
    if (chapterVisit) toolbar.current?.scrollIntoView({ block: "start" });
  }, [chapterVisit]);

  function navigate(next: BiblePassage) {
    if (next.book !== passage.book || next.chapter !== passage.chapter) {
      setPassage(next);
      setChapterVisit((visit) => visit + 1);
    }
    setPicking(null);
  }

  const loadFinished = bookLoad?.id === currentBook && bookLoad.attempt === attempt;
  const verses = loadFinished ? bookLoad.chapters?.[passage.chapter] : undefined;
  const previous = adjacentChapter(passage, -1);
  const next = adjacentChapter(passage, 1);
  if (picking === "initial") {
    return <BiblePicker current={passage} onChoose={navigate} />;
  }

  return (
    <section className={`bible-reader ${inEditor ? "bible-reader-in-editor" : "bible-reader-page"}`} aria-label="Luther Bible 1912">
      <div className="card card-outline card-primary shadow-sm mb-3">
        <div ref={toolbar} className="card-header bible-reader-toolbar d-flex align-items-center justify-content-between gap-2">
          <button type="button" className="btn btn-outline-secondary" aria-label="Previous Chapter" disabled={!previous} onClick={() => previous && navigate(previous)}>
            <i className="bi bi-chevron-left" aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-outline-primary fw-semibold" aria-label={`${passage.book.name} ${passage.chapter}, Choose A Book And Chapter`} onClick={() => setPicking("picker")}>
            <span lang="de">{passage.book.name} {passage.chapter}</span>
            <i className="bi bi-chevron-down ms-2" aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-outline-secondary" aria-label="Next Chapter" disabled={!next} onClick={() => next && navigate(next)}>
            <i className="bi bi-chevron-right" aria-hidden="true" />
          </button>
        </div>
        {verses ? (
          <VerseList key={`${currentBook}:${passage.chapter}`} passage={passage} verses={verses} />
        ) : loadFinished ? (
          <div className="card-body" role="alert">
            Could Not Load This Chapter.
            <button type="button" className="btn btn-outline-primary btn-sm ms-2" onClick={() => setAttempt((value) => value + 1)}>Try Again</button>
          </div>
        ) : (
          <div className="card-body text-body-secondary" role="status">Loading Chapter…</div>
        )}
      </div>
      <details className="small text-body-secondary px-1">
        <summary>Text Source</summary>
        <a href={sourceUrl} target="_blank" rel="noreferrer">Luther 1912 With Apocrypha (Zefania LUTH1912AP)</a>
        <p className="mb-0">Verse Numbering Follows The German Worksheets Edition. Its Digital Source Lists Verse 1 Twice In Sirach 7.</p>
      </details>
      {picking === "picker" && (
        <BiblePicker current={passage} onChoose={navigate} onClose={() => setPicking(null)} />
      )}
    </section>
  );
}

export function TextBibleDialog({ passage, onClose }: { passage: BiblePassage | null; onClose: () => void }) {
  return (
    <BibleDialog title="Luther Bible 1912" onClose={onClose} returnLabel="Back To Text">
      <BibleReader initialPassage={passage} inEditor />
    </BibleDialog>
  );
}
