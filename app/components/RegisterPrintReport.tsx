"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type PrintableRegisterService = {
  id: string;
  dateValue: string;
  type: "Lehr" | "Gebet";
  song: string;
  songBy: string;
  text: string;
  textDescription: string;
  textBy: string;
  vorrade: string;
  vorradeBy: string;
  notes: string;
};

type Props = {
  services: PrintableRegisterService[];
  years: string[];
  selectedYear: string;
  printedDate: string;
  onYearChange: (year: string) => void;
  onBack: () => void;
};

type YearGroup = {
  year: string;
  services: PrintableRegisterService[];
};

type YearPage = {
  year: string;
  serviceCount: number;
  pageNumber: number;
  pageCount: number;
  services: PrintableRegisterService[];
};

const printableDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

function groupServices(
  services: PrintableRegisterService[],
  selectedYear: string,
) {
  // The service API returns newest records first. Reverse it for chronological
  // order, then make same-day service order deterministic: Lehr before Gebet.
  // The stable sort retains entry order among records of the same type.
  const chronological = [...services].reverse().sort((left, right) => {
    const dateOrder = left.dateValue.localeCompare(right.dateValue);
    if (dateOrder !== 0) return dateOrder;
    if (left.type === right.type) return 0;
    return left.type === "Lehr" ? -1 : 1;
  });
  const grouped = new Map<string, PrintableRegisterService[]>();

  for (const service of chronological) {
    const serviceYear = service.dateValue.slice(0, 4);
    if (selectedYear !== "All Years" && serviceYear !== selectedYear) continue;
    const records = grouped.get(serviceYear) || [];
    records.push(service);
    grouped.set(serviceYear, records);
  }

  return Array.from(grouped, ([year, yearServices]) => ({
    year,
    services: yearServices,
  })).sort((left, right) => left.year.localeCompare(right.year));
}

function paginateYear(
  group: YearGroup,
  heights: Map<string, number>,
  capacity: number,
) {
  const pages: PrintableRegisterService[][] = [];
  let page: PrintableRegisterService[] = [];
  let usedHeight = 0;

  for (const service of group.services) {
    const height = heights.get(service.id) || 1;
    if (page.length > 0 && usedHeight + height > capacity) {
      pages.push(page);
      page = [];
      usedHeight = 0;
    }
    page.push(service);
    usedHeight += height;
  }

  if (page.length) pages.push(page);
  return pages;
}

function ServiceRow({
  service,
  measure,
}: {
  service: PrintableRegisterService;
  measure?: boolean;
}) {
  const secondaryDetails = [
    { label: "Song", value: service.song },
    { label: "Song By", value: service.songBy },
    { label: "Vorrade", value: service.vorrade },
    { label: "Vorrade By", value: service.vorradeBy },
  ].filter((detail) => detail.value.trim());
  const hasSecondary = secondaryDetails.length > 0 || service.notes.trim();

  return (
    <article
      className={`register-report-record ${service.type === "Lehr" ? "is-lehr" : ""}`}
      data-register-measure-id={measure ? service.id : undefined}
    >
      <div className="register-report-primary">
        <time dateTime={service.dateValue}>{printableDate(service.dateValue)}</time>
        <span className="register-report-type">{service.type}</span>
        <div className="register-report-text">
          <strong>{service.text}</strong>
          {service.textDescription && (
            <span className="register-report-description">
              {service.textDescription}
            </span>
          )}
        </div>
        <span className="register-report-text-by">{service.textBy}</span>
      </div>

      {hasSecondary && (
        <div className="register-report-secondary">
          {secondaryDetails.map((detail) => (
            <span className="register-report-detail" key={detail.label}>
              <b>{detail.label}:</b> {detail.value}
            </span>
          ))}
          {service.notes && (
            <span className="register-report-detail register-report-notes">
              <b>Notes:</b> {service.notes}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

function PageHeading({
  year,
  serviceCount,
  continued,
}: {
  year: string;
  serviceCount: number;
  continued: boolean;
}) {
  return (
    <header className="register-report-heading">
      <div>
        <h1>Lehr Register</h1>
        <p>
          <strong>{year}</strong>
          <span aria-hidden="true"> · </span>
          {serviceCount} {serviceCount === 1 ? "Service" : "Services"}
        </p>
      </div>
      <span className={`register-report-continued ${continued ? "" : "invisible"}`}>
        Continued
      </span>
    </header>
  );
}

export default function RegisterPrintReport({
  services,
  years,
  selectedYear,
  printedDate,
  onYearChange,
  onBack,
}: Props) {
  const measurementRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<YearPage[]>([]);
  const [includeGebets, setIncludeGebets] = useState(true);
  const printableServices = useMemo(
    () => (includeGebets ? services : services.filter((service) => service.type === "Lehr")),
    [includeGebets, services],
  );
  const groups = useMemo(
    () => groupServices(printableServices, selectedYear),
    [printableServices, selectedYear],
  );
  const measuredServices = useMemo(
    () => groups.flatMap((group) => group.services),
    [groups],
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const root = measurementRef.current;
      const sheet = root?.querySelector<HTMLElement>(".register-report-measure-sheet");
      const heading = sheet?.querySelector<HTMLElement>(".register-report-heading");
      const footer = sheet?.querySelector<HTMLElement>(".register-report-footer");
      const measuredRows = root?.querySelectorAll<HTMLElement>(
        "[data-register-measure-id]",
      );
      if (!sheet || !heading || !footer || !measuredRows) return;

      const sheetStyle = window.getComputedStyle(sheet);
      const headingStyle = window.getComputedStyle(heading);
      const footerStyle = window.getComputedStyle(footer);
      const innerHeight =
        sheet.clientHeight -
        (Number.parseFloat(sheetStyle.paddingTop) || 0) -
        (Number.parseFloat(sheetStyle.paddingBottom) || 0);
      const headerHeight =
        heading.getBoundingClientRect().height +
        (Number.parseFloat(headingStyle.marginBottom) || 0);
      const footerHeight =
        footer.getBoundingClientRect().height +
        (Number.parseFloat(footerStyle.marginTop) || 0);
      const capacity = Math.max(1, innerHeight - headerHeight - footerHeight);
      const heights = new Map(
        Array.from(measuredRows, (row) => [
          row.dataset.registerMeasureId || "",
          Math.ceil(row.getBoundingClientRect().height),
        ]),
      );
      const nextPages = groups.flatMap((group) => {
        const yearPages = paginateYear(group, heights, capacity);
        return yearPages.map((pageServices, pageIndex) => ({
          year: group.year,
          serviceCount: group.services.length,
          pageNumber: pageIndex + 1,
          pageCount: yearPages.length,
          services: pageServices,
        }));
      });
      setPages(nextPages);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [groups, measuredServices]);

  return (
    <div className="register-report-preview">
      <header className="register-report-toolbar shadow-sm">
        <button className="btn btn-outline-secondary" type="button" onClick={onBack}>
          <i className="bi bi-arrow-left me-1" />
          Back To Reports
        </button>
        <label className="register-report-year-control">
          <span>Report Year</span>
          <select
            className="form-select"
            value={selectedYear}
            onChange={(event) => onYearChange(event.target.value)}
          >
            <option>All Years</option>
            {years.map((year) => (
              <option key={year}>{year}</option>
            ))}
          </select>
        </label>
        <label className="register-report-gebet-control">
          <input
            className="form-check-input"
            type="checkbox"
            checked={includeGebets}
            onChange={(event) => setIncludeGebets(event.target.checked)}
          />
          <span>Include Gebets</span>
        </label>
        <button className="btn btn-primary" type="button" onClick={() => window.print()}>
          <i className="bi bi-printer me-1" />
          Print
        </button>
      </header>

      <div className="register-report-measure-root" aria-hidden="true" ref={measurementRef}>
        <section className="register-report-sheet register-report-measure-sheet">
          <PageHeading year="2026" serviceCount={999} continued />
          <div className="register-report-list">
            {measuredServices.map((service) => (
              <ServiceRow key={service.id} service={service} measure />
            ))}
          </div>
          <footer className="register-report-footer">
            <span>Printed {printedDate}</span>
            <span>2026 · Page 1 Of 1</span>
          </footer>
        </section>
      </div>

      <main className="register-report-pages" aria-label="Register Print Preview">
        {pages.map((page) => (
          <section
            className="register-report-sheet"
            key={`${page.year}-${page.pageNumber}`}
          >
            <PageHeading
              year={page.year}
              serviceCount={page.serviceCount}
              continued={page.pageNumber > 1}
            />
            <div className="register-report-list">
              {page.services.map((service) => (
                <ServiceRow key={service.id} service={service} />
              ))}
            </div>
            <footer className="register-report-footer">
              <span>Printed {printedDate}</span>
              <span>
                {page.year} · Page {page.pageNumber} Of {page.pageCount}
              </span>
            </footer>
          </section>
        ))}
      </main>
    </div>
  );
}
