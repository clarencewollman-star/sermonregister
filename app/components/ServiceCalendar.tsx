"use client";

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

export type CalendarService = {
  id: string;
  dateValue: string;
  mobileDate: string;
  type: "Lehr" | "Gebet";
  text: string;
  textBy: string;
  song: string;
  status: string;
};

type ServiceCalendarProps = {
  services: CalendarService[];
  month: string;
  minMonth: string;
  maxMonth: string;
  selectedDate: string;
  dayPanelDate: string;
  textDescriptionsByTitle: Map<string, string>;
  onMonthChange: (month: string) => void;
  onSelectedDateChange: (date: string) => void;
  onDayPanelDateChange: (date: string) => void;
  onOpenService: (service: CalendarService) => void;
  onOpenText: (text: string) => void;
  onOpenSong: (song: string) => void;
};

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day || 1, 12);
}

function monthFromParts(year: number, monthIndex: number) {
  const normalized = new Date(year, monthIndex, 1, 12);
  return `${normalized.getFullYear()}-${String(normalized.getMonth() + 1).padStart(2, "0")}`;
}

function fullDate(value: string) {
  return dateFromKey(value).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function statusClass(status: string) {
  if (status === "Completed") return "text-bg-success";
  if (status === "In Progress") return "text-bg-info";
  return "text-bg-secondary";
}

export default function ServiceCalendar({
  services,
  month,
  minMonth,
  maxMonth,
  selectedDate,
  dayPanelDate,
  textDescriptionsByTitle,
  onMonthChange,
  onSelectedDateChange,
  onDayPanelDateChange,
  onOpenService,
  onOpenText,
  onOpenSong,
}: ServiceCalendarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedDayRef = useRef<HTMLDivElement>(null);
  const monthControlRef = useRef<HTMLDivElement>(null);
  const monthDate = dateFromKey(`${month}-01`);
  const monthYear = monthDate.getFullYear();
  const monthIndex = monthDate.getMonth();
  const today = dateKey(new Date());
  const currentMonth = today.slice(0, 7);

  const servicesByDate = useMemo(() => {
    const grouped = new Map<string, CalendarService[]>();
    services.forEach((service) => {
      const existing = grouped.get(service.dateValue) || [];
      existing.push(service);
      grouped.set(service.dateValue, existing);
    });
    return grouped;
  }, [services]);

  const calendarDays = useMemo(() => {
    const firstWeekday = new Date(monthYear, monthIndex, 1, 12).getDay();
    const daysInMonth = new Date(monthYear, monthIndex + 1, 0, 12).getDate();
    const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    return Array.from({ length: cellCount }, (_, index) => {
      const date = new Date(monthYear, monthIndex, index - firstWeekday + 1, 12);
      return {
        date,
        key: dateKey(date),
        inMonth: date.getMonth() === monthIndex,
      };
    });
  }, [monthIndex, monthYear]);

  const availableYears = useMemo(() => {
    const first = Number(minMonth.slice(0, 4));
    const last = Number(maxMonth.slice(0, 4));
    return Array.from({ length: Math.max(1, last - first + 1) }, (_, index) => first + index);
  }, [maxMonth, minMonth]);

  const selectedServices = selectedDate ? servicesByDate.get(selectedDate) || [] : [];
  const panelServices = dayPanelDate ? servicesByDate.get(dayPanelDate) || [] : [];

  useEffect(() => {
    if (!selectedDate || !selectedServices.length || !selectedDayRef.current) return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    const frame = window.requestAnimationFrame(() => {
      const bounds = selectedDayRef.current?.getBoundingClientRect();
      if (!bounds || (bounds.top >= 64 && bounds.top < window.innerHeight - 120)) return;
      selectedDayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedDate, selectedServices.length]);

  useEffect(() => {
    if (!dayPanelDate) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onDayPanelDateChange("");
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [dayPanelDate, onDayPanelDateChange]);

  useEffect(() => {
    if (!pickerOpen) return;
    const closePicker = (event: MouseEvent) => {
      if (!monthControlRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    window.addEventListener("mousedown", closePicker);
    return () => window.removeEventListener("mousedown", closePicker);
  }, [pickerOpen]);

  function chooseMonth(nextMonth: string, closePicker = false) {
    const bounded = nextMonth < minMonth ? minMonth : nextMonth > maxMonth ? maxMonth : nextMonth;
    onMonthChange(bounded);
    onSelectedDateChange("");
    onDayPanelDateChange("");
    if (closePicker) setPickerOpen(false);
  }

  function moveMonth(amount: number) {
    chooseMonth(monthFromParts(monthYear, monthIndex + amount), true);
  }

  function openServiceWithKeyboard(
    event: KeyboardEvent<HTMLDivElement>,
    service: CalendarService,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenService(service);
    }
  }

  function richServiceCard(service: CalendarService) {
    const description = textDescriptionsByTitle.get(service.text) || "";
    return (
      <div
        className="list-group-item list-group-item-action mobile-service-row calendar-service-card"
        key={service.id}
        role="button"
        tabIndex={0}
        onClick={() => onOpenService(service)}
        onKeyDown={(event) => openServiceWithKeyboard(event, service)}
      >
        <div className="mobile-service-heading">
          <span className="mobile-service-date">{service.mobileDate}</span>
          <span className="mobile-service-badges">
            <span
              className={`badge ${
                service.type === "Lehr" ? "text-bg-primary" : "text-bg-warning"
              }`}
            >
              {service.type}
            </span>
            {service.status && (
              <span className={`badge mobile-service-status ${statusClass(service.status)}`}>
                {service.status}
              </span>
            )}
          </span>
        </div>
        <button
          className="btn btn-link register-record-link mobile-text-record-link"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenText(service.text);
          }}
        >
          <span className="mobile-text-title">{service.text}</span>
          {description && <span className="mobile-text-description">{description}</span>}
        </button>
        {(service.song || service.textBy) && (
          <div
            className={`mobile-service-meta ${
              service.song && service.textBy ? "has-both" : ""
            }`}
          >
            {service.textBy && (
              <span className="mobile-service-preacher">{service.textBy}</span>
            )}
            {service.song && service.textBy && (
              <span className="mobile-service-separator" aria-hidden="true">
                ·
              </span>
            )}
            {service.song && (
              <button
                className="btn btn-link register-record-link mobile-song-link"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenSong(service.song);
                }}
              >
                <i className="bi bi-music-note" aria-hidden="true" />
                <span>{service.song}</span>
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="service-calendar">
      <div className="calendar-navigation">
        <button
          className="btn btn-outline-secondary calendar-nav-button"
          type="button"
          disabled={month <= minMonth}
          aria-label="Previous Month"
          title="Previous Month"
          onClick={() => moveMonth(-1)}
        >
          <i className="bi bi-chevron-left" />
        </button>
        <div className="calendar-month-control" ref={monthControlRef}>
          <button
            className="btn btn-link calendar-month-heading"
            type="button"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((open) => !open)}
          >
            {monthNames[monthIndex]} {monthYear}
            <i className={`bi ${pickerOpen ? "bi-chevron-up" : "bi-chevron-down"} ms-2`} />
          </button>
          {pickerOpen && (
            <div className="calendar-month-picker card shadow-sm">
              <div className="card-body p-2 d-grid gap-2">
                <div className="d-flex gap-2">
                  <select
                    className="form-select form-select-sm"
                    value={monthIndex}
                    aria-label="Calendar Month"
                    onChange={(event) =>
                      chooseMonth(monthFromParts(monthYear, Number(event.target.value)))
                    }
                  >
                    {monthNames.map((name, index) => (
                      <option value={index} key={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="form-select form-select-sm"
                    value={monthYear}
                    aria-label="Calendar Year"
                    onChange={(event) =>
                      chooseMonth(monthFromParts(Number(event.target.value), monthIndex))
                    }
                  >
                    {availableYears.map((availableYear) => (
                      <option value={availableYear} key={availableYear}>
                        {availableYear}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  className="btn btn-primary btn-sm calendar-picker-done"
                  type="button"
                  onClick={() => setPickerOpen(false)}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
        <button
          className="btn btn-outline-secondary calendar-today-button"
          type="button"
          disabled={month === currentMonth}
          onClick={() => chooseMonth(currentMonth, true)}
        >
          Today
        </button>
        <button
          className="btn btn-outline-secondary calendar-nav-button"
          type="button"
          disabled={month >= maxMonth}
          aria-label="Next Month"
          title="Next Month"
          onClick={() => moveMonth(1)}
        >
          <i className="bi bi-chevron-right" />
        </button>
      </div>

      <div className="calendar-summary text-body-secondary">
        {services.length} {services.length === 1 ? "Service" : "Services"} In {monthNames[monthIndex]}{" "}
        {monthYear}
      </div>

      <div className="calendar-legend" aria-label="Calendar Legend">
        <span><i className="calendar-dot is-lehr" /> Lehr</span>
        <span><i className="calendar-dot is-gebet" /> Gebet</span>
        <span className="d-none d-md-inline-flex"><i className="calendar-dot is-progress" /> In Progress</span>
        <span className="d-none d-md-inline-flex"><i className="calendar-dot is-completed" /> Completed</span>
      </div>

      <div className="calendar-grid" role="grid" aria-label={`${monthNames[monthIndex]} ${monthYear}`}>
        {weekdays.map((weekday) => (
          <div className="calendar-weekday" role="columnheader" key={weekday}>
            <span className="d-none d-md-inline">{weekday}</span>
            <span className="d-md-none" aria-hidden="true">{weekday.slice(0, 1)}</span>
            <span className="visually-hidden d-md-none">{weekday}</span>
          </div>
        ))}
        {calendarDays.map((day) => {
          const dayServices = day.inMonth ? servicesByDate.get(day.key) || [] : [];
          const isToday = day.inMonth && day.key === today;
          const isSelected = day.key === selectedDate;
          return (
            <div
              className={`calendar-day ${day.inMonth ? "is-current-month" : "is-outside-month"} ${
                isToday ? "is-today" : ""
              } ${isSelected ? "is-selected" : ""}`}
              role="gridcell"
              aria-label={fullDate(day.key)}
              key={day.key}
            >
              <div className="calendar-date-number">{day.date.getDate()}</div>

              <div className="calendar-desktop-events d-none d-md-flex">
                {dayServices.slice(0, 3).map((service) => (
                  <button
                    className={`calendar-event ${
                      service.type === "Lehr" ? "is-lehr" : "is-gebet"
                    }`}
                    type="button"
                    key={service.id}
                    title={`${service.type}: ${service.text}${
                      service.status ? ` — ${service.status}` : ""
                    }`}
                    aria-label={`${service.type}: ${service.text}${
                      service.status ? `, ${service.status}` : ""
                    }`}
                    onClick={() => onOpenService(service)}
                  >
                    <span className="calendar-event-kind">{service.type}</span>
                    <span className="calendar-event-text">{service.text}</span>
                    {service.status && (
                      <i
                        className={`calendar-status-dot ${
                          service.status === "Completed" ? "is-completed" : "is-progress"
                        }`}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                ))}
                {dayServices.length > 3 && (
                  <button
                    className="btn btn-link calendar-more-button"
                    type="button"
                    onClick={() => onDayPanelDateChange(day.key)}
                  >
                    +{dayServices.length - 3} More
                  </button>
                )}
              </div>

              <button
                className="calendar-mobile-date-button d-md-none"
                type="button"
                disabled={!dayServices.length}
                aria-label={
                  dayServices.length
                    ? `${fullDate(day.key)}, ${dayServices.length} ${
                        dayServices.length === 1 ? "service" : "services"
                      }`
                    : fullDate(day.key)
                }
                onClick={() => onSelectedDateChange(day.key)}
              >
                {dayServices.length > 3 ? (
                  <span className="calendar-mobile-count">{dayServices.length}</span>
                ) : (
                  <span className="calendar-mobile-dots" aria-hidden="true">
                    {dayServices.map((service) => (
                      <i
                        className={`calendar-dot ${
                          service.type === "Lehr" ? "is-lehr" : "is-gebet"
                        }`}
                        key={service.id}
                      />
                    ))}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {!services.length && (
        <div className="calendar-empty-state text-center text-body-secondary">
          <i className="bi bi-calendar-x fs-3 d-block mb-2" />
          No Matching Services This Month
        </div>
      )}

      {selectedDate && selectedServices.length > 0 && (
        <div className="calendar-selected-day d-md-none" ref={selectedDayRef}>
          <div className="calendar-selected-day-heading">
            <strong>{fullDate(selectedDate)}</strong>
            <span className="text-body-secondary">
              {selectedServices.length} {selectedServices.length === 1 ? "Service" : "Services"}
            </span>
          </div>
          <div className="list-group list-group-flush compact-mobile-register">
            {selectedServices.map(richServiceCard)}
          </div>
        </div>
      )}

      {dayPanelDate && panelServices.length > 0 && (
        <div
          className="modal fade show d-block calendar-day-panel-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="calendar-day-panel-title"
        >
          <button
            className="calendar-day-panel-dismiss-layer"
            type="button"
            tabIndex={-1}
            aria-label="Close Day Details"
            onClick={() => onDayPanelDateChange("")}
          />
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content card card-primary card-outline mb-0">
              <div className="modal-header">
                <div>
                  <h5 className="modal-title" id="calendar-day-panel-title">
                    {fullDate(dayPanelDate)}
                  </h5>
                  <small className="text-body-secondary">
                    {panelServices.length} {panelServices.length === 1 ? "Service" : "Services"}
                  </small>
                </div>
                <button
                  className="btn-close"
                  type="button"
                  aria-label="Close Day Details"
                  onClick={() => onDayPanelDateChange("")}
                />
              </div>
              <div className="modal-body p-0">
                <div className="list-group list-group-flush compact-mobile-register">
                  {panelServices.map(richServiceCard)}
                </div>
              </div>
              <div className="modal-footer">
                <button
                  className="btn btn-outline-secondary"
                  type="button"
                  onClick={() => onDayPanelDateChange("")}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
