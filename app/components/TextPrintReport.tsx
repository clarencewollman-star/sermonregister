"use client";

import { useMemo } from "react";

export type PrintableTextRecord = {
  id: string;
  text: string;
  description: string;
  tags: string;
  scriptureReference: string;
  notes: string;
  timesUsed: number;
  lastUsed: string;
};

type Props = {
  records: PrintableTextRecord[];
  title: string;
  preparedDate: string;
  onTitleChange: (title: string) => void;
  onBack: () => void;
};

function firstLine(value: string) {
  return value.split(/\r?\n/, 1)[0].trim();
}

function recordWeight(record: PrintableTextRecord) {
  let weight = 0.48;
  if (record.text.length > 34) weight += 0.14;
  if (record.description) weight += record.description.length > 70 ? 0.28 : 0.18;
  if (firstLine(record.scriptureReference)) weight += 0.12;
  if (record.tags) weight += 0.1;
  if (firstLine(record.notes)) weight += 0.1;
  if (record.timesUsed > 0 || record.lastUsed !== "Never") weight += 0.08;
  return weight;
}

function paginate(records: PrintableTextRecord[]) {
  const pages: PrintableTextRecord[][] = [];
  let cursor = 0;

  while (cursor < records.length) {
    const page: PrintableTextRecord[] = [];
    let weight = 0;
    // Dense records stop at eight; short records can use otherwise empty space.
    const capacity = pages.length === 0 ? 8.4 : 9;

    while (cursor < records.length && page.length < 16) {
      const candidate = records[cursor];
      const candidateWeight = recordWeight(candidate);
      if (page.length >= 8 && weight + candidateWeight > capacity) break;
      page.push(candidate);
      weight += candidateWeight;
      cursor += 1;
    }

    pages.push(page);
  }

  return pages;
}

export default function TextPrintReport({
  records,
  title,
  preparedDate,
  onTitleChange,
  onBack,
}: Props) {
  const pages = useMemo(() => paginate(records), [records]);
  const reportTitle = title.trim() || "Selected Texts";

  return (
    <div className="text-report-preview">
      <header className="text-report-preview-toolbar shadow-sm">
        <button className="btn btn-outline-secondary" type="button" onClick={onBack}>
          <i className="bi bi-arrow-left me-1" />
          Back To Texts
        </button>
        <label className="text-report-title-control">
          <span>Report Title</span>
          <input
            className="form-control"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Selected Texts"
          />
        </label>
        <button className="btn btn-primary" type="button" onClick={() => window.print()}>
          <i className="bi bi-printer me-1" />
          Print
        </button>
      </header>

      <main className="text-report-pages" aria-label="Selected Texts Print Preview">
        {pages.map((pageRecords, pageIndex) => (
          <section className="text-report-sheet" key={`${pageIndex}-${pageRecords[0]?.id}`}>
            {pageIndex === 0 && (
              <header className="text-report-heading">
                <h1>{reportTitle}</h1>
                <p>
                  {records.length} {records.length === 1 ? "Text" : "Texts"}
                  <span aria-hidden="true"> · </span>
                  Prepared {preparedDate}
                </p>
              </header>
            )}

            <div className="text-report-list" aria-label={reportTitle}>
              {pageRecords.map((record) => (
                <article className="text-report-record" key={record.id}>
                  <h2>
                    <span className="text-report-record-number">
                      {records.indexOf(record) + 1}.
                    </span>
                    <strong className="text-report-two-lines">
                      {record.text}
                    </strong>
                  </h2>
                  {record.description && (
                    <p className="text-report-description text-report-two-lines">
                      {record.description}
                    </p>
                  )}
                  {firstLine(record.scriptureReference) && (
                    <p className="text-report-scripture text-report-one-line">
                      {firstLine(record.scriptureReference)}
                    </p>
                  )}
                  {record.tags && (
                    <p className="text-report-detail text-report-one-line">
                      <span>Tags</span> {record.tags}
                    </p>
                  )}
                  {firstLine(record.notes) && (
                    <p className="text-report-detail text-report-one-line">
                      <span>Notes</span> {firstLine(record.notes)}
                    </p>
                  )}
                  {(record.timesUsed > 0 || record.lastUsed !== "Never") && (
                    <p className="text-report-usage">
                      {record.timesUsed > 0 && (
                        <span>
                          Used {record.timesUsed} {record.timesUsed === 1 ? "Time" : "Times"}
                        </span>
                      )}
                      {record.timesUsed > 0 && record.lastUsed !== "Never" && (
                        <span aria-hidden="true"> · </span>
                      )}
                      {record.lastUsed !== "Never" && <span>Last Used {record.lastUsed}</span>}
                    </p>
                  )}
                </article>
              ))}
            </div>

            <footer className="text-report-footer">
              <span>Lehr Register</span>
              <span>
                Page {pageIndex + 1} Of {pages.length}
              </span>
            </footer>
          </section>
        ))}
      </main>
    </div>
  );
}
