"use client";

import { useEffect, useRef, useState } from "react";

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

type ReportItem = {
  number: number;
  record: PrintableTextRecord;
};

type ReportPage = {
  left: ReportItem[];
  right: ReportItem[];
};

function firstLine(value: string) {
  return value.split(/\r?\n/, 1)[0].trim();
}

function columnHeight(heights: number[], start: number, end: number, gap: number) {
  if (end <= start) return 0;
  const recordHeight = heights
    .slice(start, end)
    .reduce((total, height) => total + height, 0);
  return recordHeight + gap * Math.max(0, end - start - 1);
}

function bestColumnSplit(
  heights: number[],
  start: number,
  end: number,
  capacity: number,
  gap: number,
) {
  let bestSplit: number | null = null;
  let bestDifference = Number.POSITIVE_INFINITY;

  for (let split = start + 1; split <= end; split += 1) {
    const leftHeight = columnHeight(heights, start, split, gap);
    const rightHeight = columnHeight(heights, split, end, gap);
    if (leftHeight > capacity || rightHeight > capacity) continue;

    const difference = Math.abs(leftHeight - rightHeight);
    if (difference < bestDifference) {
      bestSplit = split;
      bestDifference = difference;
    }
  }

  return bestSplit;
}

function paginateByMeasuredHeight(
  records: PrintableTextRecord[],
  heights: number[],
  gap: number,
  firstPageCapacity: number,
  laterPageCapacity: number,
) {
  const pages: ReportPage[] = [];
  let start = 0;

  while (start < records.length) {
    const capacity = pages.length === 0 ? firstPageCapacity : laterPageCapacity;
    let end = start + 1;
    let lastFittingEnd = start;
    let lastFittingSplit = start + 1;

    while (end <= records.length) {
      const split = bestColumnSplit(heights, start, end, capacity, gap);
      if (split === null) break;
      lastFittingEnd = end;
      lastFittingSplit = split;
      end += 1;
    }

    // An unusually tall record must still make progress and stays intact.
    if (lastFittingEnd === start) {
      lastFittingEnd = start + 1;
      lastFittingSplit = start + 1;
    }

    const pageItems = records.slice(start, lastFittingEnd).map((record, index) => ({
      number: start + index + 1,
      record,
    }));
    const leftCount = Math.max(1, lastFittingSplit - start);
    pages.push({
      left: pageItems.slice(0, leftCount),
      right: pageItems.slice(leftCount),
    });
    start = lastFittingEnd;
  }

  return pages;
}

function TextReportEntry({
  record,
  number,
  measureIndex,
}: {
  record: PrintableTextRecord;
  number: number;
  measureIndex?: number;
}) {
  const scriptureReference = record.scriptureReference.trim();

  return (
    <article
      className="text-report-record"
      data-report-measure-index={measureIndex}
    >
      <h2>
        <span className="text-report-record-number">{number}.</span>
        <strong className="text-report-two-lines">{record.text}</strong>
      </h2>
      {record.description && (
        <p className="text-report-description text-report-two-lines">
          {record.description}
        </p>
      )}
      {scriptureReference && (
        <p className="text-report-scripture text-report-four-lines">
          {scriptureReference}
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
  );
}

export default function TextPrintReport({
  records,
  title,
  preparedDate,
  onTitleChange,
  onBack,
}: Props) {
  const measurementRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<ReportPage[]>([]);
  const reportTitle = title.trim() || "Selected Texts";

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const measurementRoot = measurementRef.current;
      const sheet = measurementRoot?.querySelector<HTMLElement>(
        ".text-report-measure-sheet",
      );
      const heading = sheet?.querySelector<HTMLElement>(".text-report-heading");
      const footer = sheet?.querySelector<HTMLElement>(".text-report-footer");
      const column = sheet?.querySelector<HTMLElement>(".text-report-column");
      const measuredRecords = measurementRoot?.querySelectorAll<HTMLElement>(
        "[data-report-measure-index]",
      );

      if (!sheet || !heading || !footer || !column || !measuredRecords) return;

      const sheetStyle = window.getComputedStyle(sheet);
      const headingStyle = window.getComputedStyle(heading);
      const footerStyle = window.getComputedStyle(footer);
      const columnStyle = window.getComputedStyle(column);
      const sheetInnerHeight =
        sheet.clientHeight -
        (Number.parseFloat(sheetStyle.paddingTop) || 0) -
        (Number.parseFloat(sheetStyle.paddingBottom) || 0);
      const headingHeight =
        heading.getBoundingClientRect().height +
        (Number.parseFloat(headingStyle.marginBottom) || 0);
      const footerHeight =
        footer.getBoundingClientRect().height +
        (Number.parseFloat(footerStyle.marginTop) || 0);
      const gap = Number.parseFloat(columnStyle.rowGap || columnStyle.gap) || 0;
      const heights = Array.from(measuredRecords, (record) =>
        Math.ceil(record.getBoundingClientRect().height),
      );
      const laterPageCapacity = Math.max(1, sheetInnerHeight - footerHeight);
      const firstPageCapacity = Math.max(1, laterPageCapacity - headingHeight);

      setPages(
        paginateByMeasuredHeight(
          records,
          heights,
          gap,
          firstPageCapacity,
          laterPageCapacity,
        ),
      );
    });

    return () => window.cancelAnimationFrame(frame);
  }, [preparedDate, records, reportTitle]);

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

      <div className="text-report-measure-root" aria-hidden="true" ref={measurementRef}>
        <section className="text-report-sheet text-report-measure-sheet">
          <header className="text-report-heading">
            <h1>{reportTitle}</h1>
            <p>
              {records.length} {records.length === 1 ? "Text" : "Texts"}
              <span aria-hidden="true"> · </span>
              Prepared {preparedDate}
            </p>
          </header>
          <div className="text-report-list">
            <div className="text-report-column">
              {records.map((record, index) => (
                <TextReportEntry
                  key={record.id}
                  record={record}
                  number={index + 1}
                  measureIndex={index}
                />
              ))}
            </div>
            <div className="text-report-column" />
          </div>
          <footer className="text-report-footer">
            <span>Lehr Register</span>
            <span>Page 1 Of 1</span>
          </footer>
        </section>
      </div>

      <main className="text-report-pages" aria-label="Selected Texts Print Preview">
        {pages.map((page, pageIndex) => (
          <section
            className="text-report-sheet"
            key={`${pageIndex}-${page.left[0]?.record.id}`}
          >
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
              {[page.left, page.right].map((columnRecords, columnIndex) => (
                <div className="text-report-column" key={columnIndex}>
                  {columnRecords.map(({ record, number }) => (
                    <TextReportEntry key={record.id} record={record} number={number} />
                  ))}
                </div>
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
