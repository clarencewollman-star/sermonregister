"use client";

import {
  ChangeEvent,
  FocusEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

declare const __APP_VERSION__: string;

type Service = {
  id: string;
  dateValue: string;
  date: string;
  day: string;
  mobileDate: string;
  type: "Lehr" | "Gebet";
  song: string;
  songBy: string;
  text: string;
  textTags: TagRecord[];
  textTagIds: string[];
  textBy: string;
  vorrade: string;
  vorradeBy: string;
  status: string;
  progressStatus: "" | "In Progress" | "Completed";
  progressIntent: "START" | "CONTINUE" | "AUTO" | "LEGACY" | "";
  progressStartId: string;
  completionServiceId: string;
  progressHistory: ProgressHistoryItem[];
  linkedLehrId: string;
  linkedLehrDate: string;
  linkedLehrText: string;
  linkedLehrCurrentStatus: string;
  notes: string;
};

type ProgressHistoryItem = {
  id: string;
  date: string;
  type: "LEHR" | "GEBET";
  role: "STARTED_LEHR" | "CONTINUED" | "COMPLETED_LEHR" | null;
};

type ApiService = {
  id: string;
  service_date: string;
  service_type: "LEHR" | "GEBET";
  song: string | null;
  song_by: string | null;
  text_title: string;
  text_tag_records: ApiTagRecord[];
  text_tags: string;
  text_by: string | null;
  vorrade: string | null;
  vorrade_by: string | null;
  lehr_status: "IN_PROGRESS" | "FINISHED" | null;
  linked_lehr_id: string | null;
  linked_lehr_date: string | null;
  linked_lehr_text: string | null;
  linked_lehr_status: "IN_PROGRESS" | "FINISHED" | null;
  linked_lehr_current_status: "IN_PROGRESS" | "FINISHED" | null;
  progress_id: string | null;
  progress_intent: "START" | "CONTINUE" | "AUTO" | "LEGACY" | null;
  progress_status: "IN_PROGRESS" | "FINISHED" | null;
  progress_start_service_id: string | null;
  progress_completion_service_id: string | null;
  status_label:
    | "IN_PROGRESS"
    | "FINISHED"
    | "STARTED_LEHR"
    | "CONTINUED"
    | "COMPLETED_LEHR"
    | null;
  progress_history: ProgressHistoryItem[];
  notes: string | null;
};

type Song = {
  id: string;
  title: string;
  tags: string;
  notes: string;
  timesUsed: number;
  lastUsedValue: string;
  lastUsed: string;
};

type ApiSong = {
  id: string;
  title: string;
  tags: string | null;
  notes: string | null;
  times_used: number;
  last_used: string | null;
};

type Person = {
  id: string;
  name: string;
  lastUsedValue: string;
};

type ApiPerson = {
  id: string;
  name: string;
  last_used: string | null;
};

type TextRecord = {
  id: string;
  text: string;
  description: string;
  tags: string;
  tagRecords: TagRecord[];
  tagIds: string[];
  scriptureReference: string;
  songsForText: string;
  notes: string;
  timesUsed: number;
  serviceCount: number;
  lastUsedValue: string;
  lastUsed: string;
  attachmentCount: number;
};

type ApiTextRecord = {
  id: string;
  text: string;
  description: string | null;
  tags: string | null;
  tag_records: ApiTagRecord[];
  scripture_reference: string | null;
  songs_for_text: string | null;
  notes: string | null;
  times_used: number;
  service_count: number;
  last_used: string | null;
  attachment_count: number;
};

type TagRecord = {
  id: string;
  name: string;
  sermonCount: number;
};

type ApiTagRecord = {
  id: string;
  name: string;
  sermon_count?: number;
};

type TextAttachment = {
  id: string;
  text_id: string;
  original_file_name: string;
  byte_size: number;
  created_at: string;
};

type EntryType = "" | "Lehr" | "Gebet";
type ProgressMatch = {
  id: string;
  start_service_id: string;
  last_date: string;
  service_type: "LEHR" | "GEBET";
  start_text: string;
};
type SongSortField = "title" | "tags" | "timesUsed";
type TextSortField = "text" | "tags" | "timesUsed" | "lastUsed";

const navItems = [
  { label: "Register", icon: "bi-table" },
  { label: "Texts", icon: "bi-journal-text" },
  { label: "Vorraden", icon: "bi-files" },
  { label: "Songs", icon: "bi-music-note-list" },
];

const blankDraft = () => ({
  date: "",
  type: "" as EntryType,
  song: "",
  songBy: "",
  text: "",
  textBy: "",
  vorrade: "",
  vorradeBy: "",
  status: "",
  progressIntent: "START",
  completed: false,
  notes: "",
});

const apiUrl = () => "/api/services";
const songsApiUrl = () => "/api/songs";
const peopleApiUrl = () => "/api/people";
const textsApiUrl = () => "/api/texts";
const textAttachmentsApiUrl = () => "/api/text-attachments";
const progressMatchApiUrl = () => "/api/progress-match";
const tagsApiUrl = () => "/api/tags";

const tagFromApi = (row: ApiTagRecord): TagRecord => ({
  id: row.id,
  name: row.name,
  sermonCount: Number(row.sermon_count || 0),
});

const fromApi = (row: ApiService): Service => {
  const date = new Date(`${row.service_date}T12:00:00`);
  const label = row.status_label;
  return {
    id: row.id,
    dateValue: row.service_date,
    date: date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    day: date.toLocaleDateString("en-US", { weekday: "long" }),
    mobileDate: `${date.toLocaleDateString("en-US", {
      weekday: "short",
    })} · ${date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`,
    type: row.service_type === "LEHR" ? "Lehr" : "Gebet",
    song: row.song || "",
    songBy: row.song_by || "",
    text: row.text_title,
    textTags: (row.text_tag_records || []).map(tagFromApi),
    textTagIds: (row.text_tag_records || []).map((tag) => tag.id),
    textBy: row.text_by || "",
    vorrade: row.vorrade || "",
    vorradeBy: row.vorrade_by || "",
    status:
      label === "IN_PROGRESS"
        ? "In Progress"
        : label === "FINISHED"
          ? "Completed"
          : label === "STARTED_LEHR"
            ? "Started Lehr"
            : label === "CONTINUED"
              ? "Continued"
              : label === "COMPLETED_LEHR"
                ? "Completed Lehr"
                : "",
    progressStatus:
      row.progress_status === "IN_PROGRESS"
        ? "In Progress"
        : row.progress_status === "FINISHED"
          ? "Completed"
          : "",
    progressIntent: row.progress_intent || "",
    progressStartId: row.progress_start_service_id || "",
    completionServiceId: row.progress_completion_service_id || "",
    progressHistory: row.progress_history || [],
    linkedLehrId: row.linked_lehr_id || "",
    linkedLehrDate: row.linked_lehr_date || "",
    linkedLehrText: row.linked_lehr_text || "",
    linkedLehrCurrentStatus:
      row.linked_lehr_current_status === "FINISHED"
        ? "Completed"
        : row.linked_lehr_current_status === "IN_PROGRESS"
          ? "In Progress"
          : "",
    notes: row.notes || "",
  };
};

const songFromApi = (row: ApiSong): Song => ({
  id: row.id,
  title: row.title,
  tags: row.tags || "",
  notes: row.notes || "",
  timesUsed: Number(row.times_used || 0),
  lastUsedValue: row.last_used || "",
  lastUsed: row.last_used
    ? new Date(`${row.last_used}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Never",
});

const textFromApi = (row: ApiTextRecord): TextRecord => ({
  id: row.id,
  text: row.text,
  description: row.description || "",
  tags: row.tags || "",
  tagRecords: (row.tag_records || []).map(tagFromApi),
  tagIds: (row.tag_records || []).map((tag) => tag.id),
  scriptureReference: row.scripture_reference || "",
  songsForText: row.songs_for_text || "",
  notes: row.notes || "",
  timesUsed: Number(row.times_used || 0),
  serviceCount: Number(row.service_count || 0),
  lastUsedValue: row.last_used || "",
  lastUsed: row.last_used
    ? new Date(`${row.last_used}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Never",
  attachmentCount: Number(row.attachment_count || 0),
});

const personFromApi = (row: ApiPerson): Person => ({
  id: row.id,
  name: row.name,
  lastUsedValue: row.last_used || "",
});

function recentlyUsedFirst<T extends { id: string; lastUsedValue: string }>(
  records: T[],
  label: (record: T) => string,
) {
  const alphabetical = [...records].sort((left, right) =>
    label(left).localeCompare(label(right), undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
  const recent = alphabetical
    .filter((record) => record.lastUsedValue)
    .sort(
      (left, right) =>
        right.lastUsedValue.localeCompare(left.lastUsedValue) ||
        label(left).localeCompare(label(right), undefined, {
          numeric: true,
          sensitivity: "base",
        }),
    )
    .slice(0, 6);
  const recentIds = new Set(recent.map((record) => record.id));
  return [...recent, ...alphabetical.filter((record) => !recentIds.has(record.id))];
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formHasEnteredValues(formElement: HTMLFormElement | null) {
  if (!formElement) return false;
  return Array.from(new FormData(formElement).values()).some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

function firstLine(value: string) {
  return value.split(/\r?\n/, 1)[0].trim();
}

function textUsageSummary(record: TextRecord) {
  const parts =
    record.timesUsed > 0
      ? [`${record.timesUsed} Uses`, `Last ${record.lastUsed}`]
      : ["Never Used"];
  if (record.attachmentCount) parts.push(`${record.attachmentCount} PDFs`);
  return parts.join(" · ");
}

function statusBadgeClass(status: string) {
  if (status === "Completed" || status === "Completed Lehr") {
    return "text-bg-success";
  }
  if (status === "In Progress") return "text-bg-warning";
  if (status === "Started Lehr") return "text-bg-primary";
  if (status === "Continued") return "text-bg-info";
  return "text-bg-secondary";
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return window.btoa(binary);
}

function titleCaseTag(value: string) {
  return value
    .trim()
    .toLowerCase()
    .split(/([\s-]+)/)
    .filter(Boolean)
    .map((part) =>
      /^[\s-]+$/.test(part)
        ? part.replace(/\s+/g, " ")
        : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`,
    )
    .join("");
}

function TagPicker({
  tags,
  selected,
  onChange,
}: {
  tags: TagRecord[];
  selected: TagRecord[];
  onChange: (next: TagRecord[]) => void;
}) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const selectedNames = new Set(selected.map((tag) => tag.name.toLowerCase()));
  const suggestions = tags
    .filter(
      (tag) =>
        !selectedNames.has(tag.name.toLowerCase()) &&
        (!value || tag.name.toLowerCase().includes(value.toLowerCase())),
    )
    .sort(
      (left, right) =>
        right.sermonCount - left.sermonCount || left.name.localeCompare(right.name),
    )
    .slice(0, 8);

  function addTag(tag: TagRecord) {
    if (selectedNames.has(tag.name.toLowerCase())) return;
    onChange([...selected, tag]);
    setValue("");
  }

  function addTypedTag() {
    const name = titleCaseTag(value.replace(/,$/, ""));
    if (!name) return;
    const existing = tags.find(
      (tag) => tag.name.toLowerCase() === name.toLowerCase(),
    );
    addTag(
      existing || {
        id: `new:${name.toLowerCase()}`,
        name,
        sermonCount: 0,
      },
    );
  }

  return (
    <div className="tag-picker">
      <input
        type="hidden"
        name="textTags"
        value={selected.map((tag) => tag.name).join(", ")}
      />
      <div className="tag-picker-control form-control d-flex flex-wrap gap-2 align-items-center">
        {selected.map((tag) => (
          <span className="badge text-bg-primary-subtle border tag-picker-badge" key={tag.id}>
            {tag.name}
            <button
              type="button"
              className="btn-close ms-2"
              aria-label={`Remove ${tag.name}`}
              onClick={() => onChange(selected.filter((item) => item.id !== tag.id))}
            />
          </span>
        ))}
        <input
          id="text-tags-picker"
          className="tag-picker-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addTypedTag();
            }
          }}
          placeholder={selected.length ? "Add Another Tag" : "Search Or Type A New Tag"}
          aria-label="Add Tags"
        />
      </div>
      {focused && (suggestions.length > 0 || value.trim()) && (
        <div className="list-group tag-picker-suggestions shadow-sm">
          {suggestions.map((tag) => (
            <button
              className="list-group-item list-group-item-action d-flex justify-content-between"
              type="button"
              key={tag.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => addTag(tag)}
            >
              <span>{tag.name}</span>
              <span className="badge text-bg-light border">{tag.sermonCount}</span>
            </button>
          ))}
          {value.trim() &&
            !tags.some(
              (tag) => tag.name.toLowerCase() === titleCaseTag(value).toLowerCase(),
            ) && (
              <button
                className="list-group-item list-group-item-action text-primary"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={addTypedTag}
              >
                <i className="bi bi-plus-lg me-2" />
                Add “{titleCaseTag(value)}”
              </button>
            )}
        </div>
      )}
      <div className="form-text">Choose Existing Tags Or Type A New Tag And Press Enter.</div>
    </div>
  );
}

function TextChoiceInput({
  id,
  name,
  defaultValue,
  choices,
  required = false,
}: {
  id: string;
  name: string;
  defaultValue: string;
  choices: TextRecord[];
  required?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  const [focused, setFocused] = useState(false);
  const query = value.trim().toLowerCase();
  const suggestions = choices
    .filter((record) => !query || record.text.toLowerCase().includes(query))
    .slice(0, 6);

  return (
    <div
      className="service-text-choice"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
    >
      <input
        className="form-control"
        id={id}
        name={name}
        value={value}
        autoComplete="off"
        autoCorrect="off"
        aria-autocomplete="list"
        aria-controls={`${id}-suggestions`}
        aria-expanded={focused}
        role="combobox"
        required={required}
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          setValue(event.target.value);
          setFocused(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setFocused(false);
        }}
      />
      {focused && (
        <div
          className="list-group service-text-suggestions shadow-sm"
          id={`${id}-suggestions`}
          role="listbox"
        >
          {suggestions.map((record) => (
            <button
              className="list-group-item list-group-item-action text-start"
              type="button"
              role="option"
              aria-selected={record.text === value}
              key={record.id}
              onClick={() => {
                setValue(record.text);
                setFocused(false);
              }}
            >
              <span className="d-block fw-semibold text-truncate">{record.text}</span>
              {record.description && (
                <small className="d-block text-body-secondary text-truncate">
                  {record.description}
                </small>
              )}
            </button>
          ))}
          {!suggestions.length && value.trim() && (
            <div className="list-group-item text-body-secondary small">
              No Existing Text Matches. This New Text Name Will Be Used.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TagFilter({
  tags,
  selectedIds,
  onChange,
  mobile,
  onManage,
}: {
  tags: TagRecord[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  mobile: boolean;
  onManage?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds);
  const usedTags = tags.filter((tag) => tag.sermonCount > 0);
  const activeIds = mobile ? draftIds : selectedIds;
  const mostUsed = [...usedTags]
    .sort(
      (left, right) =>
        right.sermonCount - left.sermonCount || left.name.localeCompare(right.name),
    )
    .slice(0, 6);
  const alphabetical = [...usedTags].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const matches = alphabetical.filter((tag) =>
    tag.name.toLowerCase().includes(query.toLowerCase()),
  );

  function toggle(tagId: string) {
    const next = activeIds.includes(tagId)
      ? activeIds.filter((id) => id !== tagId)
      : [...activeIds, tagId];
    if (mobile) setDraftIds(next);
    else onChange(next);
  }

  function openFilter() {
    setDraftIds(selectedIds);
    setQuery("");
    setOpen(true);
  }

  function tagOption(tag: TagRecord) {
    return (
      <label className="tag-filter-option" key={tag.id}>
        <input
          className="form-check-input"
          type="checkbox"
          checked={activeIds.includes(tag.id)}
          onChange={() => toggle(tag.id)}
        />
        <span className="flex-grow-1">{tag.name}</span>
        <span className="badge text-bg-light border">{tag.sermonCount}</span>
      </label>
    );
  }

  return (
    <div className={`tag-filter ${open ? "is-open" : ""}`}>
      <button
        className={`btn ${selectedIds.length ? "btn-primary" : "btn-outline-secondary"}`}
        type="button"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openFilter())}
      >
        <i className="bi bi-tags me-1" />
        Tags{selectedIds.length ? ` (${selectedIds.length})` : ""}
      </button>
      {open && (
        <div className={`tag-filter-panel card shadow ${mobile ? "mobile" : ""}`}>
          <div className="card-header d-flex align-items-center justify-content-between">
            <strong>Filter By Tags</strong>
            <button
              className="btn-close"
              type="button"
              aria-label="Close Tag Filter"
              onClick={() => setOpen(false)}
            />
          </div>
          <div className="card-body">
            <div className="input-group mb-3">
              <span className="input-group-text"><i className="bi bi-search" /></span>
              <input
                className="form-control"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Tags"
                aria-label="Search Tags"
              />
            </div>
            {query ? (
              <div className="tag-filter-list">
                {matches.map(tagOption)}
                {!matches.length && (
                  <div className="text-body-secondary py-2">No Tags Match Your Search.</div>
                )}
              </div>
            ) : (
              <>
                {!!mostUsed.length && (
                  <>
                    <small className="text-uppercase text-body-secondary fw-semibold">Most Used</small>
                    <div className="tag-filter-list mb-3">{mostUsed.map(tagOption)}</div>
                  </>
                )}
                <small className="text-uppercase text-body-secondary fw-semibold">All Tags</small>
                <div className="tag-filter-list">{alphabetical.map(tagOption)}</div>
              </>
            )}
          </div>
          <div className="card-footer d-flex flex-wrap justify-content-between gap-2">
            <div>
              {onManage && (
                <button
                  className="btn btn-link px-0"
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onManage();
                  }}
                >
                  Manage Tags
                </button>
              )}
            </div>
            <div className="d-flex gap-2">
              <button
                className="btn btn-outline-secondary"
                type="button"
                onClick={() => {
                  if (mobile) setDraftIds([]);
                  else onChange([]);
                }}
              >
                Clear
              </button>
              {mobile && (
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => {
                    onChange(draftIds);
                    setOpen(false);
                  }}
                >
                  Apply
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SelectedTagChips({
  tags,
  selectedIds,
  onChange,
}: {
  tags: TagRecord[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  if (!selectedIds.length) return null;
  return (
    <div className="selected-tag-chips d-flex flex-wrap align-items-center gap-2">
      <span className="text-body-secondary small">Matching All:</span>
      {selectedIds.map((id) => {
        const tag = tags.find((item) => item.id === id);
        return tag ? (
          <button
            className="badge text-bg-primary border-0"
            type="button"
            key={id}
            onClick={() => onChange(selectedIds.filter((tagId) => tagId !== id))}
          >
            {tag.name} <i className="bi bi-x-lg ms-1" />
          </button>
        ) : null;
      })}
      <button
        className="btn btn-link btn-sm p-0 selected-tag-clear"
        type="button"
        onClick={() => onChange([])}
      >
        Clear<span className="d-none d-md-inline"> Tags</span>
      </button>
    </div>
  );
}

export default function Home() {
  const [active, setActive] = useState("Register");
  const [items, setItems] = useState<Service[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All Services");
  const [year, setYear] = useState("All Years");
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [kind, setKind] = useState<EntryType>("");
  const [newServiceDate, setNewServiceDate] = useState("");
  const [newServiceText, setNewServiceText] = useState("");
  const [newMatch, setNewMatch] = useState<ProgressMatch | null>(null);
  const [newProgressIntent, setNewProgressIntent] = useState("START");
  const [newCompleted, setNewCompleted] = useState(false);
  const [newStatus, setNewStatus] = useState("IN_PROGRESS");
  const [editKind, setEditKind] = useState<EntryType>("");
  const [editProgressIntent, setEditProgressIntent] = useState("START");
  const [editProgressStatus, setEditProgressStatus] = useState("");
  const [editCompleted, setEditCompleted] = useState(false);
  const [editStatusChanged, setEditStatusChanged] = useState(false);
  const [selected, setSelected] = useState<Service | null>(null);
  const [rowVersion, setRowVersion] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [draft, setDraft] = useState(blankDraft);
  const [inlineMatch, setInlineMatch] = useState<ProgressMatch | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [songQuery, setSongQuery] = useState("");
  const [songSort, setSongSort] = useState<SongSortField>("title");
  const [songSortDirection, setSongSortDirection] = useState<"asc" | "desc">("asc");
  const [songEditor, setSongEditor] = useState<Song | "new" | null>(null);
  const [songError, setSongError] = useState("");
  const [songAutoSaveStatus, setSongAutoSaveStatus] = useState("");
  const songAutoSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const songAutoSaveFailed = useRef(false);
  const songFormRef = useRef<HTMLFormElement>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [texts, setTexts] = useState<TextRecord[]>([]);
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [textQuery, setTextQuery] = useState("");
  const [textSort, setTextSort] = useState<TextSortField>("text");
  const [textSortDirection, setTextSortDirection] = useState<"asc" | "desc">("asc");
  const [textEditor, setTextEditor] = useState<TextRecord | "new" | null>(null);
  const [textEditorTags, setTextEditorTags] = useState<TagRecord[]>([]);
  const [textError, setTextError] = useState("");
  const [textAutoSaveStatus, setTextAutoSaveStatus] = useState("");
  const textAutoSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const textAutoSaveFailed = useRef(false);
  const textFormRef = useRef<HTMLFormElement>(null);
  const [textAttachments, setTextAttachments] = useState<TextAttachment[]>([]);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [tagManagerQuery, setTagManagerQuery] = useState("");
  const [tagManagerError, setTagManagerError] = useState("");
  const [tagRenameId, setTagRenameId] = useState("");
  const [tagRenameValue, setTagRenameValue] = useState("");
  const [tagMergeId, setTagMergeId] = useState("");
  const [tagMergeTargetId, setTagMergeTargetId] = useState("");

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!draft.date || !draft.text) {
      const clearTimer = window.setTimeout(() => {
        setInlineMatch(null);
        setDraft((current) => ({
          ...current,
          progressIntent: "START",
          completed: false,
        }));
      }, 0);
      return () => window.clearTimeout(clearTimer);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const parameters = new URLSearchParams({ date: draft.date, text: draft.text });
      fetch(`${progressMatchApiUrl()}?${parameters}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((response) => response.json())
        .then((result: { match?: ProgressMatch | null }) => {
          const match = result.match || null;
          setInlineMatch(match);
          if (!match) {
            setDraft((current) =>
              current.progressIntent === "CONTINUE"
                ? { ...current, progressIntent: "START", completed: false }
                : current,
            );
          }
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setInlineMatch(null);
          }
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft.date, draft.text]);

  useEffect(() => {
    if (!newServiceDate || !newServiceText) {
      const clearTimer = window.setTimeout(() => {
        setNewMatch(null);
        setNewProgressIntent("START");
        setNewCompleted(false);
      }, 0);
      return () => window.clearTimeout(clearTimer);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const parameters = new URLSearchParams({
        date: newServiceDate,
        text: newServiceText,
      });
      fetch(`${progressMatchApiUrl()}?${parameters}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((response) => response.json())
        .then((result: { match?: ProgressMatch | null }) => {
          const match = result.match || null;
          setNewMatch(match);
          if (!match) {
            setNewProgressIntent("START");
            setNewCompleted(false);
          }
        })
        .catch(() => setNewMatch(null));
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [newServiceDate, newServiceText]);

  useEffect(() => {
    fetch(textsApiUrl())
      .then((response) => {
        if (!response.ok) throw new Error("Texts unavailable");
        return response.json();
      })
      .then((rows) => setTexts((rows as ApiTextRecord[]).map(textFromApi)))
      .catch(() => setTextError("The Texts Could Not Be Loaded."));
  }, []);

  useEffect(() => {
    fetch(tagsApiUrl())
      .then((response) => {
        if (!response.ok) throw new Error("Tags unavailable");
        return response.json();
      })
      .then((rows) => setTags((rows as ApiTagRecord[]).map(tagFromApi)))
      .catch(() => setTextError("The Tags Could Not Be Loaded."));
  }, []);

  useEffect(() => {
    fetch(songsApiUrl())
      .then((response) => {
        if (!response.ok) throw new Error("Songs unavailable");
        return response.json();
      })
      .then((rows) => setSongs((rows as ApiSong[]).map(songFromApi)))
      .catch(() => setSongError("The Songs Could Not Be Loaded."));
  }, []);

  useEffect(() => {
    void refreshPeople().catch(() =>
      setSaveError("The People List Could Not Be Loaded."),
    );
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = sessionStorage.getItem("sermon-register-service-draft");
      if (saved) {
        try {
          setDraft({ ...blankDraft(), ...JSON.parse(saved) });
          setRowVersion((version) => version + 1);
        } catch {
          sessionStorage.removeItem("sermon-register-service-draft");
        }
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    fetch(apiUrl())
      .then((response) => {
        if (!response.ok) throw new Error("Database unavailable");
        return response.json();
      })
      .then((rows) => setItems((rows as ApiService[]).map(fromApi)))
      .catch(() =>
        setSaveError(
          "The SQLite Database Could Not Be Reached. Check The Container Logs.",
        ),
      );
  }, []);

  const visible = useMemo(
    () =>
      items.filter(
        (service) =>
          (filter === "All Services" ||
            (filter === "Lehr" && service.type === "Lehr") ||
            (filter === "Gebet" && service.type === "Gebet") ||
            (filter === "In Progress Lehrs" &&
              service.progressStartId === service.id &&
              service.progressStatus === "In Progress") ||
            (filter === "Completed Lehrs" &&
              service.progressStartId === service.id &&
              service.progressStatus === "Completed")) &&
          (year === "All Years" || service.dateValue.startsWith(`${year}-`)) &&
          selectedTagIds.every((tagId) => service.textTagIds.includes(tagId)) &&
          `${Object.values(service).join(" ")} ${service.textTags
            .map((tag) => tag.name)
            .join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [items, query, filter, year, selectedTagIds],
  );

  const years = useMemo(
    () =>
      Array.from(new Set(items.map((service) => service.dateValue.slice(0, 4))))
        .filter(Boolean)
        .sort((left, right) => right.localeCompare(left)),
    [items],
  );

  const visibleSongs = useMemo(
    () => {
      const filteredSongs = songs.filter((song) =>
        `${song.title} ${song.tags} ${song.notes}`
          .toLowerCase()
          .includes(songQuery.toLowerCase()),
      );
      return filteredSongs.sort((left, right) => {
        if (songSort === "tags" && (!left.tags || !right.tags)) {
          if (!left.tags && !right.tags) return 0;
          return !left.tags ? 1 : -1;
        }
        const comparison =
          songSort === "timesUsed"
            ? left.timesUsed - right.timesUsed
            : left[songSort].localeCompare(right[songSort], undefined, {
                numeric: true,
                sensitivity: "base",
              });
        return songSortDirection === "asc" ? comparison : -comparison;
      });
    },
    [songs, songQuery, songSort, songSortDirection],
  );

  const visibleTexts = useMemo(
    () => {
      const filteredTexts = texts.filter(
        (record) =>
          selectedTagIds.every((tagId) => record.tagIds.includes(tagId)) &&
          `${record.text} ${record.description} ${record.tags} ${record.scriptureReference} ${record.songsForText} ${record.notes}`
            .toLowerCase()
            .includes(textQuery.toLowerCase()),
      );
      return filteredTexts.sort((left, right) => {
        if (textSort === "tags" && (!left.tags || !right.tags)) {
          if (!left.tags && !right.tags) return 0;
          return !left.tags ? 1 : -1;
        }
        const comparison =
          textSort === "timesUsed"
            ? left.timesUsed - right.timesUsed
            : textSort === "lastUsed"
              ? left.lastUsedValue.localeCompare(right.lastUsedValue)
              : textSort === "tags"
                ? left.tags.localeCompare(right.tags, undefined, {
                    numeric: true,
                    sensitivity: "base",
                  })
              : left.text.localeCompare(right.text, undefined, {
                  numeric: true,
                  sensitivity: "base",
                });
        return textSortDirection === "asc" ? comparison : -comparison;
      });
    },
    [texts, textQuery, textSort, textSortDirection, selectedTagIds],
  );

  const managedTags = useMemo(
    () =>
      [...tags]
        .filter((tag) =>
          tag.name.toLowerCase().includes(tagManagerQuery.toLowerCase()),
        )
        .sort((left, right) => left.name.localeCompare(right.name)),
    [tags, tagManagerQuery],
  );

  const songChoices = useMemo(
    () => recentlyUsedFirst(songs, (song) => song.title),
    [songs],
  );

  const textChoices = useMemo(
    () => recentlyUsedFirst(texts, (record) => record.text),
    [texts],
  );

  const textDescriptionsByTitle = useMemo(
    () => new Map(texts.map((record) => [record.text, record.description])),
    [texts],
  );

  const peopleChoices = useMemo(
    () => recentlyUsedFirst(people, (person) => person.name),
    [people],
  );

  function changeTextSort(field: TextSortField) {
    if (textSort === field) {
      setTextSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setTextSort(field);
    setTextSortDirection(
      field === "timesUsed" || field === "lastUsed" ? "desc" : "asc",
    );
  }

  function changeSongSort(field: SongSortField) {
    if (songSort === field) {
      setSongSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSongSort(field);
    setSongSortDirection(field === "timesUsed" ? "desc" : "asc");
  }

  async function refreshSongs() {
    const response = await fetch(songsApiUrl(), { cache: "no-store" });
    if (!response.ok) throw new Error("Could Not Refresh Songs");
    const rows = (await response.json()) as ApiSong[];
    setSongs(rows.map(songFromApi));
  }

  async function refreshServices() {
    const response = await fetch(apiUrl(), { cache: "no-store" });
    if (!response.ok) throw new Error("Could Not Refresh Services");
    setItems(((await response.json()) as ApiService[]).map(fromApi));
  }

  async function refreshTexts() {
    const response = await fetch(textsApiUrl(), { cache: "no-store" });
    if (!response.ok) throw new Error("Could Not Refresh Texts");
    const rows = (await response.json()) as ApiTextRecord[];
    setTexts(rows.map(textFromApi));
  }

  async function refreshTags() {
    const response = await fetch(tagsApiUrl(), { cache: "no-store" });
    if (!response.ok) throw new Error("Could Not Refresh Tags");
    setTags(((await response.json()) as ApiTagRecord[]).map(tagFromApi));
  }

  async function refreshPeople() {
    const response = await fetch(peopleApiUrl(), { cache: "no-store" });
    if (!response.ok) throw new Error("Could Not Refresh People");
    setPeople(((await response.json()) as ApiPerson[]).map(personFromApi));
  }

  async function loadTextAttachments(textId: string) {
    const response = await fetch(
      `${textAttachmentsApiUrl()}?textId=${encodeURIComponent(textId)}`,
      { cache: "no-store" },
    );
    const result = (await response.json()) as TextAttachment[] | { error?: string };
    if (!response.ok || !Array.isArray(result)) {
      throw new Error(
        (!Array.isArray(result) && result.error) || "Could Not Load PDFs",
      );
    }
    setTextAttachments(result);
  }

  async function createService(payload: Record<string, string>) {
    setSaveError("");
    const response = await fetch(apiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as ApiService & { error?: string };
    if (!response.ok) throw new Error(result.error || "Could Not Save Service");
    await refreshServices();
    void refreshSongs().catch(() => setSongError("The Songs Could Not Be Refreshed."));
    void refreshTexts().catch(() => setTextError("The Texts Could Not Be Refreshed."));
    void refreshPeople().catch(() =>
      setSaveError("The People List Could Not Be Refreshed."),
    );
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !editKind) return;
    const form = new FormData(event.currentTarget);
    setSaveError("");
    try {
      const response = await fetch(apiUrl(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          date: String(form.get("editDate")),
          type: editKind.toUpperCase(),
          song: String(form.get("editSong")),
          songBy: String(form.get("editSongBy")),
          text: String(form.get("editText")),
          textBy: String(form.get("editTextBy")),
          vorrade: String(form.get("editVorrade") || ""),
          vorradeBy: String(form.get("editVorradeBy") || ""),
          status: editProgressStatus,
          progressIntent: editKind === "Lehr" ? editProgressIntent : "AUTO",
          completed: editCompleted,
          statusChanged: editStatusChanged,
          notes: String(form.get("editNotes") || ""),
        }),
      });
      const result = (await response.json()) as ApiService & { error?: string };
      if (!response.ok) throw new Error(result.error || "Could Not Update Service");
      await refreshServices();
      setSelected(null);
      void refreshSongs().catch(() => setSongError("The Songs Could Not Be Refreshed."));
      void refreshTexts().catch(() => setTextError("The Texts Could Not Be Refreshed."));
      void refreshPeople().catch(() =>
        setSaveError("The People List Could Not Be Refreshed."),
      );
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could Not Update Service");
    }
  }

  async function deleteSelectedService() {
    if (!selected) return;
    if (!window.confirm("Delete This Service? This Cannot Be Undone.")) return;
    setSaveError("");
    try {
      const response = await fetch(apiUrl(), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id }),
      });
      const result = (await response.json()) as { id?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "Could Not Delete Service");
      await refreshServices();
      setSelected(null);
      void refreshSongs().catch(() => setSongError("The Songs Could Not Be Refreshed."));
      void refreshTexts().catch(() => setTextError("The Texts Could Not Be Refreshed."));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could Not Delete Service");
    }
  }

  function songPayload(formElement: HTMLFormElement) {
    const form = new FormData(formElement);
    return {
      title: String(form.get("songTitle") || "").trim(),
      tags: String(form.get("songTags") || ""),
      notes: String(form.get("songNotes") || ""),
    };
  }

  function textPayload(
    formElement: HTMLFormElement,
    tagSelection: TagRecord[] = textEditorTags,
  ) {
    const form = new FormData(formElement);
    return {
      text: String(form.get("textText") || "").trim(),
      description: String(form.get("textDescription") || ""),
      tags: tagSelection.map((tag) => tag.name),
      scriptureReference: String(form.get("textScriptureReference") || ""),
      songsForText: String(form.get("textSongsForText") || ""),
      notes: String(form.get("textNotes") || ""),
    };
  }

  const closeSongEditor = useCallback(async () => {
    if (!songEditor) return;
    if (
      songEditor === "new" &&
      formHasEnteredValues(songFormRef.current) &&
      !window.confirm("Close Without Saving This New Song?")
    ) {
      return;
    }
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      songFormRef.current?.contains(activeElement)
    ) {
      activeElement.blur();
    }
    await songAutoSaveQueue.current;
    if (songAutoSaveFailed.current) return;
    setSongEditor(null);
  }, [songEditor]);

  const closeTextEditor = useCallback(async () => {
    if (!textEditor) return;
    if (pdfUploading) {
      setTextError("Please Wait For The PDF Upload To Finish Before Closing.");
      return;
    }
    if (
      textEditor === "new" &&
      formHasEnteredValues(textFormRef.current) &&
      !window.confirm("Close Without Saving This New Text?")
    ) {
      return;
    }
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      textFormRef.current?.contains(activeElement)
    ) {
      activeElement.blur();
    }
    await textAutoSaveQueue.current;
    if (textAutoSaveFailed.current) return;
    setTextEditor(null);
  }, [pdfUploading, textEditor]);

  function autoSaveSong(event: FocusEvent<HTMLFormElement>) {
    if (!songEditor || songEditor === "new") return;
    const target = event.target as HTMLElement;
    if (!target.matches("input[name], textarea[name]")) return;
    const payload = songPayload(event.currentTarget);
    if (!payload.title) {
      songAutoSaveFailed.current = true;
      setSongError("Song Title Is Required.");
      return;
    }
    const songId = songEditor.id;
    songAutoSaveQueue.current = songAutoSaveQueue.current.then(async () => {
      songAutoSaveFailed.current = false;
      setSongAutoSaveStatus("Saving...");
      setSongError("");
      try {
        const response = await fetch(songsApiUrl(), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: songId, ...payload }),
        });
        const result = (await response.json()) as ApiSong & { error?: string };
        if (!response.ok) throw new Error(result.error || "Could Not Save Song");
        const saved = songFromApi(result);
        setSongs((current) =>
          current
            .map((song) => (song.id === saved.id ? saved : song))
            .sort((left, right) => left.title.localeCompare(right.title)),
        );
        setSongAutoSaveStatus("Saved Automatically");
      } catch (error) {
        songAutoSaveFailed.current = true;
        setSongError(error instanceof Error ? error.message : "Could Not Save Song");
        setSongAutoSaveStatus("Automatic Save Failed");
      }
    });
  }

  async function saveSong(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!songEditor) return;
    const formElement = event.currentTarget;
    await songAutoSaveQueue.current;
    const payload = songPayload(formElement);
    if (!payload.title) {
      setSongError("Song Title Is Required.");
      return;
    }
    const currentEditor = songEditor;
    songAutoSaveFailed.current = false;
    setSongAutoSaveStatus("Saving...");
    setSongError("");
    try {
      const response = await fetch(songsApiUrl(), {
        method: currentEditor === "new" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: currentEditor === "new" ? "" : currentEditor.id,
          ...payload,
        }),
      });
      const result = (await response.json()) as ApiSong & { error?: string };
      if (!response.ok) throw new Error(result.error || "Could Not Save Song");
      const saved = songFromApi(result);
      setSongs((current) => {
        const next =
          currentEditor === "new"
            ? [...current, saved]
            : current.map((song) => (song.id === saved.id ? saved : song));
        return next.sort((left, right) => left.title.localeCompare(right.title));
      });
      setSongEditor(saved);
      setSongAutoSaveStatus("Saved");
    } catch (error) {
      songAutoSaveFailed.current = true;
      setSongError(error instanceof Error ? error.message : "Could Not Save Song");
      setSongAutoSaveStatus("Save Failed");
    }
  }

  function openSongEditor(record: Song | "new") {
    setSongError("");
    setSongAutoSaveStatus("");
    songAutoSaveFailed.current = false;
    setSongEditor(record);
  }

  function openTextEditor(record: TextRecord) {
    setTextError("");
    setTextAutoSaveStatus("");
    textAutoSaveFailed.current = false;
    setTextAttachments([]);
    setTextEditorTags(record.tagRecords);
    setTextEditor(record);
    void loadTextAttachments(record.id).catch((error) =>
      setTextError(error instanceof Error ? error.message : "Could Not Load PDFs"),
    );
  }

  function autoSaveText(event: FocusEvent<HTMLFormElement>) {
    if (!textEditor || textEditor === "new") return;
    const target = event.target as HTMLElement;
    if (!target.matches("input[name], textarea[name]")) return;
    const payload = textPayload(event.currentTarget);
    if (!payload.text) {
      textAutoSaveFailed.current = true;
      setTextError("Text Is Required.");
      return;
    }
    const textId = textEditor.id;
    textAutoSaveQueue.current = textAutoSaveQueue.current.then(async () => {
      textAutoSaveFailed.current = false;
      setTextAutoSaveStatus("Saving...");
      setTextError("");
      try {
        const response = await fetch(textsApiUrl(), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: textId, ...payload }),
        });
        const result = (await response.json()) as ApiTextRecord & { error?: string };
        if (!response.ok) throw new Error(result.error || "Could Not Save Text");
        const saved = textFromApi(result);
        setTextEditorTags(saved.tagRecords);
        setTexts((current) =>
          current
            .map((record) => (record.id === saved.id ? saved : record))
            .sort((left, right) => left.text.localeCompare(right.text)),
        );
        setTextAutoSaveStatus("Saved Automatically");
      } catch (error) {
        textAutoSaveFailed.current = true;
        setTextError(error instanceof Error ? error.message : "Could Not Save Text");
        setTextAutoSaveStatus("Automatic Save Failed");
      }
    });
  }

  function changeTextEditorTags(next: TagRecord[]) {
    const previous = textEditorTags;
    setTextEditorTags(next);
    if (!textEditor || textEditor === "new" || !textFormRef.current) return;
    const textId = textEditor.id;
    const payload = textPayload(textFormRef.current, next);
    textAutoSaveQueue.current = textAutoSaveQueue.current.then(async () => {
      textAutoSaveFailed.current = false;
      setTextAutoSaveStatus("Saving...");
      setTextError("");
      try {
        const response = await fetch(textsApiUrl(), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: textId, ...payload }),
        });
        const result = (await response.json()) as ApiTextRecord & { error?: string };
        if (!response.ok) throw new Error(result.error || "Could Not Save Tags");
        const saved = textFromApi(result);
        setTexts((current) =>
          current
            .map((record) => (record.id === saved.id ? saved : record))
            .sort((left, right) => left.text.localeCompare(right.text)),
        );
        setTextEditorTags(saved.tagRecords);
        setTextEditor((current) =>
          current && current !== "new" && current.id === saved.id ? saved : current,
        );
        await Promise.all([refreshTags(), refreshServices()]);
        setTextAutoSaveStatus("Saved Automatically");
      } catch (error) {
        setTextEditorTags(previous);
        textAutoSaveFailed.current = true;
        setTextError(error instanceof Error ? error.message : "Could Not Save Tags");
        setTextAutoSaveStatus("Automatic Save Failed");
      }
    });
  }

  async function saveText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!textEditor) return;
    const formElement = event.currentTarget;
    await textAutoSaveQueue.current;
    const payload = textPayload(formElement);
    if (!payload.text) {
      setTextError("Text Is Required.");
      return;
    }
    const currentEditor = textEditor;
    textAutoSaveFailed.current = false;
    setTextAutoSaveStatus("Saving...");
    setTextError("");
    try {
      const response = await fetch(textsApiUrl(), {
        method: currentEditor === "new" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: currentEditor === "new" ? "" : currentEditor.id,
          ...payload,
        }),
      });
      const result = (await response.json()) as ApiTextRecord & { error?: string };
      if (!response.ok) throw new Error(result.error || "Could Not Save Text");
      const saved = textFromApi(result);
      setTextEditorTags(saved.tagRecords);
      setTexts((current) => {
        const next =
          currentEditor === "new"
            ? [...current, saved]
            : current.map((record) => (record.id === saved.id ? saved : record));
        return next.sort((left, right) => left.text.localeCompare(right.text));
      });
      setTextEditor(saved);
      await Promise.all([refreshTags(), refreshServices()]);
      setTextAutoSaveStatus("Saved");
    } catch (error) {
      textAutoSaveFailed.current = true;
      setTextError(error instanceof Error ? error.message : "Could Not Save Text");
      setTextAutoSaveStatus("Save Failed");
    }
  }

  async function finishTagMutation() {
    await Promise.all([refreshTags(), refreshTexts(), refreshServices()]);
  }

  async function renameTag(tagId: string) {
    const name = titleCaseTag(tagRenameValue);
    if (!name) {
      setTagManagerError("Tag Name Is Required.");
      return;
    }
    setTagManagerError("");
    try {
      const response = await fetch(tagsApiUrl(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", id: tagId, name }),
      });
      const result = (await response.json()) as ApiTagRecord & { error?: string };
      if (!response.ok) throw new Error(result.error || "Could Not Rename Tag");
      setTagRenameId("");
      setTagRenameValue("");
      await finishTagMutation();
    } catch (error) {
      setTagManagerError(error instanceof Error ? error.message : "Could Not Rename Tag");
    }
  }

  async function mergeTag(tagId: string) {
    if (!tagMergeTargetId || tagMergeTargetId === tagId) {
      setTagManagerError("Choose A Different Tag To Merge Into.");
      return;
    }
    const source = tags.find((tag) => tag.id === tagId);
    const target = tags.find((tag) => tag.id === tagMergeTargetId);
    if (!source || !target) return;
    if (!window.confirm(`Merge ${source.name} Into ${target.name}?`)) return;
    setTagManagerError("");
    try {
      const response = await fetch(tagsApiUrl(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "merge", id: tagId, targetId: target.id }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could Not Merge Tags");
      setSelectedTagIds((current) =>
        Array.from(new Set(current.map((id) => (id === tagId ? target.id : id)))),
      );
      setTagMergeId("");
      setTagMergeTargetId("");
      await finishTagMutation();
    } catch (error) {
      setTagManagerError(error instanceof Error ? error.message : "Could Not Merge Tags");
    }
  }

  async function deleteTag(tag: TagRecord) {
    const message = tag.sermonCount
      ? `Delete ${tag.name}? It Will Be Removed From ${tag.sermonCount} Sermon${tag.sermonCount === 1 ? "" : "s"}.`
      : `Delete ${tag.name}?`;
    if (!window.confirm(message)) return;
    setTagManagerError("");
    try {
      const response = await fetch(tagsApiUrl(), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: tag.id }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could Not Delete Tag");
      setSelectedTagIds((current) => current.filter((id) => id !== tag.id));
      await finishTagMutation();
    } catch (error) {
      setTagManagerError(error instanceof Error ? error.message : "Could Not Delete Tag");
    }
  }

  async function deleteText() {
    if (!textEditor || textEditor === "new" || textEditor.serviceCount > 0) return;
    if (!window.confirm("Delete This Text? This Cannot Be Undone.")) return;
    await textAutoSaveQueue.current;
    if (textAutoSaveFailed.current) return;
    setTextError("");
    try {
      const response = await fetch(textsApiUrl(), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: textEditor.id }),
      });
      const result = (await response.json()) as { id?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "Could Not Delete Text");
      setTexts((current) =>
        current.filter((record) => record.id !== textEditor.id),
      );
      setTextAttachments([]);
      setTextEditor(null);
    } catch (error) {
      setTextError(error instanceof Error ? error.message : "Could Not Delete Text");
    }
  }

  async function uploadTextPdfs(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    if (!files.length || !textEditor || textEditor === "new") return;
    setPdfUploading(true);
    setTextError("");
    try {
      for (const file of files) {
        if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
          throw new Error(`${file.name} Is Not A PDF File.`);
        }
        if (file.size > 25 * 1024 * 1024) {
          throw new Error(`${file.name} Is Larger Than 25 MB.`);
        }
        const response = await fetch(textAttachmentsApiUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            textId: textEditor.id,
            fileName: file.name,
            mimeType: file.type || "application/pdf",
            data: arrayBufferToBase64(await file.arrayBuffer()),
          }),
        });
        const result = (await response.json()) as TextAttachment & { error?: string };
        if (!response.ok) throw new Error(result.error || `Could Not Add ${file.name}`);
      }
      await loadTextAttachments(textEditor.id);
      await refreshTexts();
    } catch (error) {
      setTextError(error instanceof Error ? error.message : "Could Not Add PDFs");
    } finally {
      input.value = "";
      setPdfUploading(false);
    }
  }

  async function removeTextAttachment(attachment: TextAttachment) {
    if (!window.confirm(`Remove ${attachment.original_file_name}?`)) return;
    setTextError("");
    try {
      const response = await fetch(textAttachmentsApiUrl(), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: attachment.id }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could Not Remove PDF");
      setTextAttachments((current) =>
        current.filter((record) => record.id !== attachment.id),
      );
      await refreshTexts();
    } catch (error) {
      setTextError(error instanceof Error ? error.message : "Could Not Remove PDF");
    }
  }

  function openSongFromRegister(title: string) {
    const song = songs.find(
      (record) => record.title.localeCompare(title, undefined, { sensitivity: "base" }) === 0,
    );
    if (!song) return;
    openSongEditor(song);
  }

  function openTextFromRegister(value: string) {
    const record = texts.find(
      (candidate) =>
        candidate.text.localeCompare(value, undefined, { sensitivity: "base" }) === 0,
    );
    if (!record) return;
    openTextEditor(record);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!kind) return;
    const form = new FormData(event.currentTarget);
    try {
      await createService({
        date: String(form.get("date")),
        type: kind.toUpperCase(),
        song: String(form.get("song")),
        songBy: String(form.get("songBy")),
        text: String(form.get("text")),
        textBy: String(form.get("textBy")),
        vorrade: String(form.get("vorrade") || ""),
        vorradeBy: String(form.get("vorradeBy") || ""),
        status: kind === "Lehr" && newProgressIntent === "START" ? newStatus : "",
        progressIntent: kind === "Lehr" ? newProgressIntent : "AUTO",
        completed: newCompleted ? "true" : "false",
        notes: String(form.get("notes") || ""),
      });
      setOpen(false);
      setKind("");
      setNewServiceDate("");
      setNewServiceText("");
      setNewProgressIntent("START");
      setNewCompleted(false);
      setNewStatus("IN_PROGRESS");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could Not Save Service");
    }
  }

  function persistInlineDraft() {
    const formElement = document.getElementById(
      "inline-service-form",
    ) as HTMLFormElement | null;
    if (!formElement) return;
    const form = new FormData(formElement);
    const nextDraft = {
      date: String(form.get("inlineDate") || ""),
      type: String(form.get("inlineType") || "") as EntryType,
      song: String(form.get("inlineSong") || ""),
      songBy: String(form.get("inlineSongBy") || ""),
      text: String(form.get("inlineText") || ""),
      textBy: String(form.get("inlineTextBy") || ""),
      vorrade: String(form.get("inlineVorrade") || ""),
      vorradeBy: String(form.get("inlineVorradeBy") || ""),
      status: String(form.get("inlineStatus") || ""),
      progressIntent: String(form.get("inlineProgressIntent") || "START"),
      completed: form.get("inlineCompleted") === "on",
      notes: String(form.get("inlineNotes") || ""),
    };
    setDraft(nextDraft);
    sessionStorage.setItem(
      "sermon-register-service-draft",
      JSON.stringify(nextDraft),
    );
  }

  async function saveInline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = String(form.get("inlineDate"));
    const type = String(form.get("inlineType")) as EntryType;
    const song = String(form.get("inlineSong") || "").trim();
    const songBy = String(form.get("inlineSongBy") || "").trim();
    const text = String(form.get("inlineText") || "").trim();
    const textBy = String(form.get("inlineTextBy") || "").trim();
    const vorrade = String(form.get("inlineVorrade") || "").trim();
    const vorradeBy = String(form.get("inlineVorradeBy") || "").trim();
    const status = String(form.get("inlineStatus") || "").trim();
    const progressIntent = String(
      form.get("inlineProgressIntent") || "START",
    ).trim();
    const completed = form.get("inlineCompleted") === "on";
    const notes = String(form.get("inlineNotes") || "");
    if (!date || !type || !text) {
      setSaveError("Complete Date, Type, And Text.");
      return;
    }
    try {
      await createService({
        date,
        type: type.toUpperCase(),
        song,
        songBy,
        text,
        textBy,
        vorrade,
        vorradeBy,
        status,
        progressIntent,
        completed: completed ? "true" : "false",
        notes,
      });
      sessionStorage.removeItem("sermon-register-service-draft");
      setDraft(blankDraft());
      setRowVersion((version) => version + 1);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could Not Save Service");
    }
  }

  function clearInline() {
    sessionStorage.removeItem("sermon-register-service-draft");
    setDraft(blankDraft());
    setRowVersion((version) => version + 1);
  }

  function changeSection(section: string) {
    setActive(section);
    setSidebarOpen(false);
  }

  function openService(service: Service) {
    setSaveError("");
    setEditKind(service.type);
    setEditProgressIntent(
      service.type === "Lehr" && service.progressStartId !== service.id
        ? "CONTINUE"
        : "START",
    );
    setEditProgressStatus(
      service.progressStatus === "Completed"
        ? "FINISHED"
        : service.progressStatus === "In Progress"
          ? "IN_PROGRESS"
          : "",
    );
    setEditCompleted(service.completionServiceId === service.id);
    setEditStatusChanged(false);
    setSelected(service);
  }

  function startNew() {
    setActive("Register");
    clearInline();
    setKind("");
    if (mobile) {
      setOpen(true);
    } else {
      window.setTimeout(
        () =>
          document
            .querySelector<HTMLInputElement>('input[name="inlineDate"]')
            ?.focus(),
        0,
      );
    }
  }

  useEffect(() => {
    if (!songEditor && !textEditor) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (songEditor) {
        void closeSongEditor();
      } else {
        void closeTextEditor();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeSongEditor, closeTextEditor, songEditor, textEditor]);

  return (
    <div className="app-wrapper">
      <form id="inline-service-form" onSubmit={saveInline} />

      <header className="app-header navbar navbar-expand bg-body shadow-sm">
        <div className="container-fluid">
          <button
            className="btn btn-link d-lg-none px-2"
            type="button"
            aria-label="Open Navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <i className="bi bi-list fs-4" />
          </button>
          <span className="navbar-brand d-flex align-items-center mb-0">
            <span className="brand-mark">
              <i className="bi bi-book-half" aria-hidden="true" />
            </span>
            <span className="d-none d-sm-inline">Lehr Register</span>
          </span>
          <div className="ms-auto d-flex align-items-center gap-2">
            <span
              className="badge text-bg-light border app-version"
              aria-label={`Version ${__APP_VERSION__}`}
            >
              v{__APP_VERSION__}
            </span>
          </div>
        </div>
      </header>

      <aside
        className={`app-sidebar bg-body-secondary shadow ${sidebarOpen ? "sidebar-open" : ""}`}
        data-bs-theme="dark"
      >
        <div className="sidebar-brand">
          <span className="brand-mark">
            <i className="bi bi-book-half" aria-hidden="true" />
          </span>
          <span className="brand-text fw-semibold">Lehr Register</span>
        </div>
        <div className="sidebar-wrapper">
          <nav className="mt-2" aria-label="Main Navigation">
            <ul className="nav sidebar-menu flex-column" role="menu">
              {navItems.map((item) => (
                <li className="nav-item" role="none" key={item.label}>
                  <button
                    type="button"
                    role="menuitem"
                    className={`nav-link ${active === item.label ? "active" : ""}`}
                    aria-current={active === item.label ? "page" : undefined}
                    onClick={() => changeSection(item.label)}
                  >
                    <i className={`nav-icon bi ${item.icon}`} />
                    <p>{item.label}</p>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="sidebar-status">
            <i className="bi bi-shield-lock-fill me-2" />
            Private SQLite Register
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close Navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="app-main">
        <div className="app-content-header">
          <div className="container-fluid">
            <div className="row align-items-center">
              <div className="col-sm-6">
                <h3 className="mb-0">
                  {active === "Register" ? "Lehr Register" : active}
                  {active === "Texts" && (
                    <span className="mobile-page-count d-sm-none">
                      <span aria-hidden="true"> · </span>
                      {visibleTexts.length}
                    </span>
                  )}
                </h3>
                <p className="text-body-secondary mb-0 mt-1">
                  {active === "Register"
                    ? "Weekly Lehr And Gebet History"
                    : `Reusable ${active} Records`}
                </p>
              </div>
              <div className="col-sm-6 d-none d-sm-block">
                <ol className="breadcrumb float-sm-end mb-0">
                  <li className="breadcrumb-item">Lehr Register</li>
                  <li className="breadcrumb-item active" aria-current="page">
                    {active}
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </div>

        <div className="app-content">
          <div className="container-fluid">
            {active === "Register" ? (
              <div className="card card-primary card-outline shadow-sm register-card">
                <div className="card-header register-toolbar border-bottom">
                  <div className="row g-2 align-items-center d-none d-md-flex">
                    <div className="col-12 col-lg">
                      <div className="input-group">
                        <span className="input-group-text">
                          <i className="bi bi-search" />
                        </span>
                        <input
                          className="form-control"
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder="Search Texts, Songs, People, Or Notes"
                          aria-label="Search Services"
                        />
                      </div>
                    </div>
                    <div className="col-auto">
                      <TagFilter
                        tags={tags}
                        selectedIds={selectedTagIds}
                        onChange={setSelectedTagIds}
                        mobile={false}
                      />
                    </div>
                    <div className="col-6 col-lg-auto">
                      <select
                        className="form-select"
                        value={filter}
                        onChange={(event) => setFilter(event.target.value)}
                        aria-label="Service Type"
                      >
                        <option>All Services</option>
                        <option>Lehr</option>
                        <option>Gebet</option>
                        <option>In Progress Lehrs</option>
                        <option>Completed Lehrs</option>
                      </select>
                    </div>
                    <div className="col-6 col-lg-auto">
                      <select
                        className="form-select"
                        value={year}
                        onChange={(event) => setYear(event.target.value)}
                        aria-label="Year"
                      >
                        <option>All Years</option>
                        {years.map((availableYear) => (
                          <option key={availableYear}>{availableYear}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-auto ms-lg-auto">
                      <span className="badge text-bg-primary rounded-pill">
                        {visible.length} Services
                      </span>
                    </div>
                  </div>
                  <div className="mobile-register-toolbar d-md-none">
                    <div className="d-flex gap-2">
                      <div className="input-group flex-grow-1 min-width-0">
                        <span className="input-group-text">
                          <i className="bi bi-search" />
                        </span>
                        <input
                          className="form-control"
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder="Search Services"
                          aria-label="Search Services"
                        />
                      </div>
                      <button
                        className="btn btn-primary flex-shrink-0"
                        type="button"
                        onClick={startNew}
                      >
                        <i className="bi bi-plus-lg me-1" />
                        Add
                      </button>
                    </div>
                    <div className="row g-2 mt-0">
                      <div className="col-5">
                        <select
                          className="form-select"
                          value={filter}
                          onChange={(event) => setFilter(event.target.value)}
                          aria-label="Service Type"
                        >
                          <option>All Services</option>
                          <option>Lehr</option>
                          <option>Gebet</option>
                          <option>In Progress Lehrs</option>
                          <option>Completed Lehrs</option>
                        </select>
                      </div>
                      <div className="col-4">
                        <select
                          className="form-select"
                          value={year}
                          onChange={(event) => setYear(event.target.value)}
                          aria-label="Year"
                        >
                          <option>All Years</option>
                          {years.map((availableYear) => (
                            <option key={availableYear}>{availableYear}</option>
                          ))}
                        </select>
                      </div>
                      <div className="col-3">
                        <TagFilter
                          tags={tags}
                          selectedIds={selectedTagIds}
                          onChange={setSelectedTagIds}
                          mobile
                        />
                      </div>
                    </div>
                  </div>
                  <SelectedTagChips
                    tags={tags}
                    selectedIds={selectedTagIds}
                    onChange={setSelectedTagIds}
                  />
                </div>

                {saveError && (
                  <div className="alert alert-danger m-3 mb-0" role="alert">
                    <i className="bi bi-exclamation-triangle-fill me-2" />
                    {saveError}
                  </div>
                )}

                <div className="table-responsive desktop-register-table">
                  <table className="table table-hover align-middle mb-0 register-table">
                    <thead className="table-light">
                      <tr>
                        <th className="date-column">Date</th>
                        <th className="type-column">Type</th>
                        <th className="content-column song-column">Song</th>
                        <th className="person-column">Song By</th>
                        <th className="content-column text-column">Text</th>
                        <th className="person-column">Text By</th>
                        <th className="content-column vorrade-column">Vorrade</th>
                        <th className="person-column">Vorrade By</th>
                        <th className="notes-column">Notes</th>
                        <th className="status-column">Status</th>
                        <th className="actions-column">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        className="inline-entry-row"
                        key={rowVersion}
                        onInput={persistInlineDraft}
                      >
                        <td className="date-column">
                          <input
                            className="form-control form-control-sm"
                            form="inline-service-form"
                            name="inlineDate"
                            type="date"
                            defaultValue={draft.date}
                            aria-label="New Service Date"
                          />
                        </td>
                        <td className="type-column">
                          <select
                            className="form-select form-select-sm"
                            form="inline-service-form"
                            name="inlineType"
                            value={draft.type}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                type: event.target.value as EntryType,
                                status:
                                  event.target.value === "Lehr"
                                    ? draft.status || "IN_PROGRESS"
                                    : "",
                                progressIntent: "START",
                                completed: false,
                              })
                            }
                            aria-label="New Service Type"
                          >
                            <option value="">Choose Type</option>
                            <option>Lehr</option>
                            <option>Gebet</option>
                          </select>
                        </td>
                        <td className="content-column song-column">
                          <input
                            className="form-control form-control-sm"
                            form="inline-service-form"
                            name="inlineSong"
                            list="songs-list"
                            defaultValue={draft.song}
                            placeholder="Type New"
                            aria-label="New Service Song"
                          />
                        </td>
                        <td className="person-column">
                          <input
                            className="form-control form-control-sm"
                            form="inline-service-form"
                            name="inlineSongBy"
                            list="people-list"
                            defaultValue={draft.songBy}
                            placeholder="Choose Or Type New"
                            aria-label="New Service Song By"
                          />
                        </td>
                        <td className="content-column text-column">
                          <input
                            className="form-control form-control-sm"
                            form="inline-service-form"
                            name="inlineText"
                            list="texts-list"
                            defaultValue={draft.text}
                            placeholder="Type New"
                            aria-label="New Service Text"
                          />
                        </td>
                        <td className="person-column">
                          <input
                            className="form-control form-control-sm"
                            form="inline-service-form"
                            name="inlineTextBy"
                            list="people-list"
                            defaultValue={draft.textBy}
                            placeholder="Choose Or Type New"
                            aria-label="New Service Text By"
                          />
                        </td>
                        <td className="content-column vorrade-column">
                          {draft.type === "Lehr" ? (
                            <input
                              className="form-control form-control-sm"
                              form="inline-service-form"
                              name="inlineVorrade"
                              list="vorraden-list"
                              defaultValue={draft.vorrade}
                              placeholder="Type New"
                              aria-label="New Service Vorrade"
                            />
                          ) : (
                            <span className="text-body-secondary">—</span>
                          )}
                        </td>
                        <td className="person-column">
                          {draft.type === "Lehr" ? (
                            <input
                              className="form-control form-control-sm"
                              form="inline-service-form"
                              name="inlineVorradeBy"
                              list="people-list"
                              defaultValue={draft.vorradeBy}
                              placeholder="Choose Or Type New"
                              aria-label="New Service Vorrade By"
                            />
                          ) : (
                            <span className="text-body-secondary">—</span>
                          )}
                        </td>
                        <td className="notes-column">
                          <input
                            className="form-control form-control-sm"
                            form="inline-service-form"
                            name="inlineNotes"
                            defaultValue={draft.notes}
                            placeholder="Add Notes"
                            aria-label="New Service Notes"
                          />
                        </td>
                        <td className="status-column">
                          {draft.type === "Lehr" ? (
                            <select
                              className="form-select form-select-sm"
                              form="inline-service-form"
                              name="inlineStatus"
                              value={draft.status || "IN_PROGRESS"}
                              onChange={(event) =>
                                setDraft({ ...draft, status: event.target.value })
                              }
                              aria-label="New Lehr Status"
                            >
                              <option value="IN_PROGRESS">In Progress</option>
                              <option value="FINISHED">Completed</option>
                            </select>
                          ) : (
                            <span className="text-body-secondary">—</span>
                          )}
                        </td>
                        <td className="actions-column">
                          <span className="inline-entry-actions">
                            <button
                              form="inline-service-form"
                              type="submit"
                              className="btn btn-primary btn-sm"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline-secondary btn-sm"
                              onClick={clearInline}
                            >
                              Clear
                            </button>
                          </span>
                        </td>
                      </tr>

                      {draft.type && draft.date && draft.text && (
                        <tr className="inline-progress-helper-row">
                          <td colSpan={11}>
                            <div className="alert alert-info d-flex flex-wrap align-items-center gap-3 mb-0 py-2 px-3">
                              <span className="fw-semibold">
                                <i className="bi bi-diagram-3 me-2" />
                                {inlineMatch
                                  ? `Matching In-Progress Lehr Last Active ${inlineMatch.last_date}`
                                  : "No In-Progress Lehr Found — This Service Starts A New Lehr"}
                              </span>
                              {draft.type === "Lehr" && inlineMatch && (
                                <select
                                  className="form-select form-select-sm w-auto"
                                  form="inline-service-form"
                                  name="inlineProgressIntent"
                                  value={draft.progressIntent}
                                  onChange={(event) =>
                                    setDraft({
                                      ...draft,
                                      progressIntent: event.target.value,
                                    })
                                  }
                                  aria-label="New Lehr Progress Choice"
                                >
                                  <option value="START">Start New Lehr</option>
                                  <option value="CONTINUE">Continue Existing Lehr</option>
                                </select>
                              )}
                              {(draft.type === "Gebet" ||
                                (draft.type === "Lehr" &&
                                  draft.progressIntent === "CONTINUE")) && (
                                <div className="form-check mb-0">
                                  <input
                                    className="form-check-input"
                                    form="inline-service-form"
                                    id="inline-completed"
                                    name="inlineCompleted"
                                    type="checkbox"
                                    checked={draft.completed}
                                    onChange={(event) =>
                                      setDraft({
                                        ...draft,
                                        completed: event.target.checked,
                                      })
                                    }
                                  />
                                  <label
                                    className="form-check-label fw-semibold"
                                    htmlFor="inline-completed"
                                  >
                                    Completed
                                  </label>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}

                      {visible.map((service) => (
                        <tr
                          className="service-row"
                          key={service.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openService(service)}
                          onKeyDown={(event) =>
                            (event.key === "Enter" || event.key === " ") &&
                            openService(service)
                          }
                        >
                          <td className="service-date date-column">
                            <strong>{service.date}</strong>
                            <small>{service.day}</small>
                          </td>
                          <td className="type-column">
                            <span
                              className={`badge ${service.type === "Lehr" ? "text-bg-primary" : "text-bg-warning"}`}
                            >
                              {service.type}
                            </span>
                          </td>
                          <td className="song-column">
                            {service.song ? (
                              <button
                                className="btn btn-link register-record-link"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openSongFromRegister(service.song);
                                }}
                              >
                                {service.song}
                              </button>
                            ) : null}
                          </td>
                          <td className="person-column">{service.songBy}</td>
                          <td className="fw-semibold text-column">
                            <button
                              className="btn btn-link register-record-link fw-semibold"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openTextFromRegister(service.text);
                              }}
                            >
                              {service.text}
                            </button>
                            {textDescriptionsByTitle.get(service.text) && (
                              <small className="d-block fw-normal text-body-secondary mt-1 lh-sm">
                                {textDescriptionsByTitle.get(service.text)}
                              </small>
                            )}
                            {!!service.textTags.length && (
                              <span className="d-flex flex-wrap gap-1 mt-2 service-text-tags">
                                {service.textTags.map((tag) => (
                                  <button
                                    className="badge text-bg-light border tag-badge-button"
                                    type="button"
                                    key={tag.id}
                                    onKeyDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setSelectedTagIds([tag.id]);
                                    }}
                                  >
                                    {tag.name}
                                  </button>
                                ))}
                              </span>
                            )}
                          </td>
                          <td className="person-column">{service.textBy}</td>
                          <td className="vorrade-column">{service.vorrade}</td>
                          <td className="person-column">{service.vorradeBy}</td>
                          <td className="note-cell notes-column">{service.notes}</td>
                          <td className="status-column">
                            {service.status && (
                              <span className={`badge ${statusBadgeClass(service.status)}`}>
                                {service.status}
                              </span>
                            )}
                          </td>
                          <td className="actions-column" />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="list-group list-group-flush mobile-service-list compact-mobile-register">
                  {visible.map((service) => (
                    <div
                      className="list-group-item list-group-item-action mobile-service-row"
                      key={service.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openService(service)}
                      onKeyDown={(event) =>
                        (event.key === "Enter" || event.key === " ") &&
                        openService(service)
                      }
                    >
                      <div className="mobile-service-heading">
                        <span className="mobile-service-date">
                          {service.mobileDate}
                        </span>
                        <span
                          className={`badge ${service.type === "Lehr" ? "text-bg-primary" : "text-bg-warning"}`}
                        >
                          {service.type}
                        </span>
                      </div>
                      <button
                        className="btn btn-link register-record-link mobile-text-record-link"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openTextFromRegister(service.text);
                        }}
                      >
                        <span className="mobile-text-title">{service.text}</span>
                        {textDescriptionsByTitle.get(service.text) && (
                          <span className="mobile-text-description">
                            {textDescriptionsByTitle.get(service.text)}
                          </span>
                        )}
                      </button>
                      {(service.song || service.textBy) && (
                        <div
                          className={`mobile-service-meta ${
                            service.song && service.textBy ? "has-both" : ""
                          }`}
                        >
                          {service.textBy && (
                            <span className="mobile-service-preacher">
                              {service.textBy}
                            </span>
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
                                openSongFromRegister(service.song);
                              }}
                            >
                              <i className="bi bi-music-note" aria-hidden="true" />
                              <span>{service.song}</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {!visible.length && (
                  <div className="card-body text-center text-body-secondary py-5 register-empty-state">
                    <i className="bi bi-inbox fs-2 d-block mb-2" />
                    No Services Match Your Search.
                  </div>
                )}
              </div>
            ) : active === "Texts" ? (
              <div className="card card-primary card-outline shadow-sm texts-card">
                <div className="card-header border-bottom text-toolbar">
                  <div className="row g-2 align-items-center d-none d-md-flex">
                    <div className="col-12 col-md">
                      <div className="input-group">
                        <span className="input-group-text">
                          <i className="bi bi-search" />
                        </span>
                        <input
                          className="form-control"
                          value={textQuery}
                          onChange={(event) => setTextQuery(event.target.value)}
                          placeholder="Search Texts, Descriptions, Tags, Scripture References, Or Notes"
                          aria-label="Search Texts"
                        />
                      </div>
                    </div>
                    <div className="col-auto">
                      <TagFilter
                        tags={tags}
                        selectedIds={selectedTagIds}
                        onChange={setSelectedTagIds}
                        mobile={false}
                        onManage={() => {
                          setTagManagerError("");
                          setTagManagerQuery("");
                          setTagManagerOpen(true);
                        }}
                      />
                    </div>
                    <div className="col-auto">
                      <span className="badge text-bg-primary rounded-pill">
                        {visibleTexts.length} Texts
                      </span>
                    </div>
                    <div className="col-auto">
                      <button
                        className="btn btn-primary"
                        type="button"
                        onClick={() => {
                          setTextError("");
                          setTextAutoSaveStatus("");
                          textAutoSaveFailed.current = false;
                          setTextAttachments([]);
                          setTextEditorTags([]);
                          setTextEditor("new");
                        }}
                      >
                        <i className="bi bi-plus-lg me-1" />
                        Add Text
                      </button>
                    </div>
                  </div>
                  <div className="mobile-text-toolbar d-md-none">
                    <div className="input-group">
                      <span className="input-group-text">
                        <i className="bi bi-search" />
                      </span>
                      <input
                        className="form-control"
                        value={textQuery}
                        onChange={(event) => setTextQuery(event.target.value)}
                        placeholder="Search Texts"
                        aria-label="Search Texts"
                      />
                    </div>
                    <div className="mobile-text-toolbar-actions">
                      <select
                        className="form-select"
                        value={`${textSort}:${textSortDirection}`}
                        onChange={(event) => {
                          const [field, direction] = event.target.value.split(":") as [
                            TextSortField,
                            "asc" | "desc",
                          ];
                          setTextSort(field);
                          setTextSortDirection(direction);
                        }}
                        aria-label="Sort Texts By"
                      >
                        <option value="text:asc">Text A–Z</option>
                        <option value="text:desc">Text Z–A</option>
                        <option value="tags:asc">Tags A–Z</option>
                        <option value="tags:desc">Tags Z–A</option>
                        <option value="timesUsed:desc">Most Used</option>
                        <option value="timesUsed:asc">Least Used</option>
                        <option value="lastUsed:desc">Recently Used</option>
                        <option value="lastUsed:asc">Oldest Used</option>
                      </select>
                      <TagFilter
                        tags={tags}
                        selectedIds={selectedTagIds}
                        onChange={setSelectedTagIds}
                        mobile
                        onManage={() => {
                          setTagManagerError("");
                          setTagManagerQuery("");
                          setTagManagerOpen(true);
                        }}
                      />
                      <button
                        className="btn btn-primary flex-shrink-0"
                        type="button"
                        onClick={() => {
                          setTextError("");
                          setTextAutoSaveStatus("");
                          textAutoSaveFailed.current = false;
                          setTextAttachments([]);
                          setTextEditorTags([]);
                          setTextEditor("new");
                        }}
                      >
                        <i className="bi bi-plus-lg me-1" />
                        Add
                      </button>
                    </div>
                  </div>
                  <div className="d-none d-md-block">
                    <SelectedTagChips
                      tags={tags}
                      selectedIds={selectedTagIds}
                      onChange={setSelectedTagIds}
                    />
                  </div>
                  <div className="mobile-text-selected-tags d-md-none">
                    <SelectedTagChips
                      tags={tags}
                      selectedIds={selectedTagIds}
                      onChange={setSelectedTagIds}
                    />
                  </div>
                </div>

                {textError && !textEditor && (
                  <div className="alert alert-danger m-3 mb-0" role="alert">
                    <i className="bi bi-exclamation-triangle-fill me-2" />
                    {textError}
                  </div>
                )}

                <div className="table-responsive desktop-texts-table">
                  <table className="table table-hover align-middle mb-0 texts-table">
                    <thead className="table-light">
                      <tr>
                        <th
                          aria-sort={
                            textSort === "text"
                              ? textSortDirection === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            className="sort-header-button"
                            type="button"
                            onClick={() => changeTextSort("text")}
                          >
                            Text
                            {textSort === "text" && (
                              <i
                                className={`bi ${
                                  textSortDirection === "asc"
                                    ? "bi-caret-up-fill"
                                    : "bi-caret-down-fill"
                                }`}
                              />
                            )}
                          </button>
                        </th>
                        <th>Description</th>
                        <th>Scripture Reference</th>
                        <th
                          aria-sort={
                            textSort === "tags"
                              ? textSortDirection === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            className="sort-header-button"
                            type="button"
                            onClick={() => changeTextSort("tags")}
                          >
                            Tags
                            {textSort === "tags" && (
                              <i
                                className={`bi ${
                                  textSortDirection === "asc"
                                    ? "bi-caret-up-fill"
                                    : "bi-caret-down-fill"
                                }`}
                              />
                            )}
                          </button>
                        </th>
                        <th
                          className="text-center"
                          aria-sort={
                            textSort === "timesUsed"
                              ? textSortDirection === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            className="sort-header-button justify-content-center"
                            type="button"
                            onClick={() => changeTextSort("timesUsed")}
                          >
                            Times Used
                            {textSort === "timesUsed" && (
                              <i
                                className={`bi ${
                                  textSortDirection === "asc"
                                    ? "bi-caret-up-fill"
                                    : "bi-caret-down-fill"
                                }`}
                              />
                            )}
                          </button>
                        </th>
                        <th
                          aria-sort={
                            textSort === "lastUsed"
                              ? textSortDirection === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            className="sort-header-button"
                            type="button"
                            onClick={() => changeTextSort("lastUsed")}
                          >
                            Last Used
                            {textSort === "lastUsed" && (
                              <i
                                className={`bi ${
                                  textSortDirection === "asc"
                                    ? "bi-caret-up-fill"
                                    : "bi-caret-down-fill"
                                }`}
                              />
                            )}
                          </button>
                        </th>
                        <th>Notes</th>
                        <th className="text-center">PDFs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleTexts.map((record) => (
                        <tr
                          className="service-row"
                          key={record.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openTextEditor(record)}
                          onKeyDown={(event) =>
                            (event.key === "Enter" || event.key === " ") &&
                            openTextEditor(record)
                          }
                        >
                          <td className="fw-semibold text-name-cell">
                            {record.text}
                          </td>
                          <td className="text-description-cell">
                            {record.description}
                          </td>
                          <td className="scripture-reference-cell">
                            {firstLine(record.scriptureReference)}
                          </td>
                          <td className="text-tags-cell">
                            <span className="d-flex flex-wrap gap-1">
                              {record.tags
                                .split(",")
                                .map((tag) => tag.trim())
                                .filter(Boolean)
                                .map((tag) => {
                                  const tagRecord = record.tagRecords.find(
                                    (item) => item.name === tag,
                                  );
                                  return (
                                    <button
                                      className="badge text-bg-light border tag-badge-button"
                                      type="button"
                                      key={tag}
                                      onKeyDown={(event) => event.stopPropagation()}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        if (tagRecord) setSelectedTagIds([tagRecord.id]);
                                      }}
                                    >
                                      {tag}
                                    </button>
                                  );
                                })}
                            </span>
                          </td>
                          <td className="text-center">{record.timesUsed}</td>
                          <td>{record.lastUsed}</td>
                          <td className="note-cell">{record.notes}</td>
                          <td className="text-center">
                            {record.attachmentCount ? (
                              <span className="badge text-bg-light border">
                                <i className="bi bi-file-earmark-pdf me-1" />
                                {record.attachmentCount}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="list-group list-group-flush mobile-text-list compact-mobile-texts">
                  {visibleTexts.map((record) => {
                    const alphabeticalTags = [...record.tagRecords].sort((left, right) =>
                      left.name.localeCompare(right.name),
                    );
                    const visibleTags = alphabeticalTags.slice(0, 2);
                    const hiddenTagCount = Math.max(0, alphabeticalTags.length - 2);
                    const scripture = firstLine(record.scriptureReference);
                    return (
                      <div
                        role="button"
                        tabIndex={0}
                        className="list-group-item list-group-item-action mobile-library-text-row"
                        key={record.id}
                        onClick={() => openTextEditor(record)}
                        onKeyDown={(event) =>
                          (event.key === "Enter" || event.key === " ") &&
                          openTextEditor(record)
                        }
                      >
                        <strong className="mobile-library-text-title">
                          {record.text}
                        </strong>
                        {record.description && (
                          <span className="mobile-library-text-description">
                            {record.description}
                          </span>
                        )}
                        {(scripture || visibleTags.length > 0) && (
                          <div className="mobile-library-reference-row">
                            {scripture && (
                              <span
                                className="mobile-library-scripture"
                                title={scripture}
                              >
                                <i className="bi bi-book" aria-hidden="true" />
                                <span>{scripture}</span>
                              </span>
                            )}
                            {visibleTags.length > 0 && (
                              <span className="mobile-library-tags">
                                {visibleTags.map((tag) => (
                                  <button
                                    className="badge text-bg-primary-subtle border tag-badge-button"
                                    type="button"
                                    key={tag.id}
                                    title={tag.name}
                                    aria-label={`Filter By Tag ${tag.name}`}
                                    onKeyDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setSelectedTagIds([tag.id]);
                                    }}
                                  >
                                    {tag.name}
                                  </button>
                                ))}
                                {hiddenTagCount > 0 && (
                                  <span
                                    className="badge text-bg-light border mobile-library-more-tags"
                                    aria-label={`${hiddenTagCount} More Tags`}
                                  >
                                    +{hiddenTagCount}
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                        )}
                        <small className="mobile-library-usage">
                          {textUsageSummary(record)}
                        </small>
                      </div>
                    );
                  })}
                </div>

                {!visibleTexts.length && (
                  <div className="card-body text-center text-body-secondary py-5">
                    <i className="bi bi-journal-text fs-2 d-block mb-2" />
                    No Texts Match Your Search.
                  </div>
                )}
              </div>
            ) : active === "Songs" ? (
              <div className="card card-primary card-outline shadow-sm songs-card">
                <div className="card-header border-bottom">
                  <div className="row g-2 align-items-center">
                    <div className="col-12 col-md">
                      <div className="input-group">
                        <span className="input-group-text">
                          <i className="bi bi-search" />
                        </span>
                        <input
                          className="form-control"
                          value={songQuery}
                          onChange={(event) => setSongQuery(event.target.value)}
                          placeholder="Search Titles, Tags, Or Notes"
                          aria-label="Search Songs"
                        />
                      </div>
                    </div>
                    <div className="col-8 d-md-none">
                      <select
                        className="form-select"
                        value={songSort}
                        onChange={(event) => {
                          const field = event.target.value as SongSortField;
                          setSongSort(field);
                          setSongSortDirection(field === "timesUsed" ? "desc" : "asc");
                        }}
                        aria-label="Sort Songs By"
                      >
                        <option value="title">Sort By Title</option>
                        <option value="tags">Sort By Tags</option>
                        <option value="timesUsed">Sort By Times Used</option>
                      </select>
                    </div>
                    <div className="col-4 d-md-none">
                      <button
                        className="btn btn-outline-secondary w-100"
                        type="button"
                        onClick={() =>
                          setSongSortDirection((current) =>
                            current === "asc" ? "desc" : "asc",
                          )
                        }
                        aria-label={
                          songSortDirection === "asc"
                            ? "Sort Descending"
                            : "Sort Ascending"
                        }
                      >
                        <i
                          className={`bi ${
                            songSortDirection === "asc"
                              ? "bi-sort-up"
                              : "bi-sort-down"
                          }`}
                        />
                      </button>
                    </div>
                    <div className="col-auto">
                      <span className="badge text-bg-primary rounded-pill">
                        {visibleSongs.length} Songs
                      </span>
                    </div>
                    <div className="col-auto">
                      <button
                        className="btn btn-primary"
                        type="button"
                        onClick={() => openSongEditor("new")}
                      >
                        <i className="bi bi-plus-lg me-1" />
                        Add Song
                      </button>
                    </div>
                  </div>
                </div>

                {songError && (
                  <div className="alert alert-danger m-3 mb-0" role="alert">
                    <i className="bi bi-exclamation-triangle-fill me-2" />
                    {songError}
                  </div>
                )}

                <div className="table-responsive desktop-songs-table">
                  <table className="table table-hover align-middle mb-0 songs-table">
                    <thead className="table-light">
                      <tr>
                        <th
                          aria-sort={
                            songSort === "title"
                              ? songSortDirection === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            className="sort-header-button"
                            type="button"
                            onClick={() => changeSongSort("title")}
                          >
                            Title
                            {songSort === "title" && (
                              <i
                                className={`bi ${
                                  songSortDirection === "asc"
                                    ? "bi-caret-up-fill"
                                    : "bi-caret-down-fill"
                                }`}
                              />
                            )}
                          </button>
                        </th>
                        <th
                          aria-sort={
                            songSort === "tags"
                              ? songSortDirection === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            className="sort-header-button"
                            type="button"
                            onClick={() => changeSongSort("tags")}
                          >
                            Tags
                            {songSort === "tags" && (
                              <i
                                className={`bi ${
                                  songSortDirection === "asc"
                                    ? "bi-caret-up-fill"
                                    : "bi-caret-down-fill"
                                }`}
                              />
                            )}
                          </button>
                        </th>
                        <th
                          className="text-center"
                          aria-sort={
                            songSort === "timesUsed"
                              ? songSortDirection === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            className="sort-header-button justify-content-center"
                            type="button"
                            onClick={() => changeSongSort("timesUsed")}
                          >
                            Times Used
                            {songSort === "timesUsed" && (
                              <i
                                className={`bi ${
                                  songSortDirection === "asc"
                                    ? "bi-caret-up-fill"
                                    : "bi-caret-down-fill"
                                }`}
                              />
                            )}
                          </button>
                        </th>
                        <th>Last Used</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleSongs.map((song) => (
                        <tr
                          className="service-row"
                          key={song.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openSongEditor(song)}
                          onKeyDown={(event) =>
                            (event.key === "Enter" || event.key === " ") &&
                            openSongEditor(song)
                          }
                        >
                          <td className="fw-semibold">{song.title}</td>
                          <td>
                            <span className="d-flex flex-wrap gap-1">
                              {song.tags
                                .split(",")
                                .map((tag) => tag.trim())
                                .filter(Boolean)
                                .map((tag) => (
                                  <span className="badge text-bg-light border" key={tag}>
                                    {tag}
                                  </span>
                                ))}
                            </span>
                          </td>
                          <td className="text-center">{song.timesUsed}</td>
                          <td>{song.lastUsed}</td>
                          <td className="note-cell">{song.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="list-group list-group-flush mobile-song-list">
                  {visibleSongs.map((song) => (
                    <button
                      type="button"
                      className="list-group-item list-group-item-action p-3 text-start"
                      key={song.id}
                      onClick={() => openSongEditor(song)}
                    >
                      <strong className="d-block">{song.title}</strong>
                      {song.tags && (
                        <span className="d-flex flex-wrap gap-1 mt-2">
                          {song.tags
                            .split(",")
                            .map((tag) => tag.trim())
                            .filter(Boolean)
                            .map((tag) => (
                              <span className="badge text-bg-light border" key={tag}>
                                {tag}
                              </span>
                            ))}
                        </span>
                      )}
                      <small className="d-block text-body-secondary mt-2">
                        {song.timesUsed} Times Used · Last Used {song.lastUsed}
                      </small>
                      {song.notes && (
                        <span className="d-block text-body-secondary mt-2">
                          {song.notes}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {!visibleSongs.length && (
                  <div className="card-body text-center text-body-secondary py-5">
                    <i className="bi bi-music-note-list fs-2 d-block mb-2" />
                    No Songs Match Your Search.
                  </div>
                )}
              </div>
            ) : (
              <div className="card card-outline card-primary shadow-sm">
                <div className="card-body empty-state">
                  <div className="empty-state-icon">
                    <i className={`bi ${navItems.find((item) => item.label === active)?.icon}`} />
                  </div>
                  <h4>{active}</h4>
                  <p className="text-body-secondary mb-0">
                    This Reusable-Record View Is Ready For The Next Development Stage.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="app-footer">
        <span className="float-end d-none d-sm-inline app-version">
          Version {__APP_VERSION__}
        </span>
          <strong>Lehr Register</strong> · Private SQLite Storage
      </footer>

      <nav className="mobile-tabbar nav nav-pills nav-fill border-top shadow-lg">
        {navItems.slice(0, 4).map((item) => (
          <button
            type="button"
            key={item.label}
            className={`nav-link ${active === item.label ? "active" : ""}`}
            onClick={() => changeSection(item.label)}
          >
            <i className={`bi ${item.icon}`} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {open && (
        <div
          className="modal fade show d-block service-form-modal"
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-service-title"
        >
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <div>
                  <small className="text-uppercase text-body-secondary">
                    Register Entry
                  </small>
                  <h5 className="modal-title" id="new-service-title">
                    New Service
                  </h5>
                </div>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={() => setOpen(false)}
                />
              </div>
              <form onSubmit={save}>
                <div className="modal-body">
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label" htmlFor="service-date">
                        Date
                      </label>
                      <input
                        className="form-control"
                        id="service-date"
                        name="date"
                        type="date"
                        value={newServiceDate}
                        onChange={(event) => setNewServiceDate(event.target.value)}
                        required
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" htmlFor="service-type">
                        Service Type
                      </label>
                      <select
                        className="form-select"
                        id="service-type"
                        value={kind}
                        onChange={(event) =>
                          {
                            setKind(event.target.value as EntryType);
                            setNewProgressIntent("START");
                            setNewCompleted(false);
                            setNewStatus("IN_PROGRESS");
                          }
                        }
                        required
                      >
                        <option value="">Choose Type</option>
                        <option>Lehr</option>
                        <option>Gebet</option>
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" htmlFor="service-song">
                        Song
                      </label>
                      <input
                        className="form-control"
                        id="service-song"
                        name="song"
                        list="songs-list"
                        placeholder="Type A New Song"
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" htmlFor="service-song-by">
                        Song By
                      </label>
                      <input
                        className="form-control"
                        id="service-song-by"
                        name="songBy"
                        list="people-list"
                        placeholder="Choose Or Type A New Person"
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label" htmlFor="service-text">
                        Text
                      </label>
                      <input
                        className="form-control"
                        id="service-text"
                        name="text"
                        list="texts-list"
                        placeholder="Type A New Text"
                        value={newServiceText}
                        onChange={(event) => setNewServiceText(event.target.value)}
                        required
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" htmlFor="service-text-by">
                        Text By
                      </label>
                      <input
                        className="form-control"
                        id="service-text-by"
                        name="textBy"
                        list="people-list"
                        placeholder="Choose Or Type A New Person"
                      />
                    </div>
                    {kind === "Lehr" && (
                      <>
                        <div className="col-md-6">
                          <label className="form-label" htmlFor="service-vorrade">
                            Vorrade
                          </label>
                          <input
                            className="form-control"
                            id="service-vorrade"
                            name="vorrade"
                            list="vorraden-list"
                            placeholder="Type A New Vorrade"
                          />
                        </div>
                        <div className="col-md-6">
                          <label className="form-label" htmlFor="service-vorrade-by">
                            Vorrade By
                          </label>
                          <input
                            className="form-control"
                            id="service-vorrade-by"
                            name="vorradeBy"
                            list="people-list"
                            placeholder="Choose Or Type A New Person"
                          />
                        </div>
                        {newMatch && (
                          <div className="col-12">
                            <div className="card bg-body-tertiary border-0 mb-0">
                              <div className="card-body py-3">
                                <div className="fw-semibold mb-2">
                                  Matching In-Progress Lehr Last Active {newMatch.last_date}
                                </div>
                                <select
                                  className="form-select"
                                  value={newProgressIntent}
                                  onChange={(event) =>
                                    setNewProgressIntent(event.target.value)
                                  }
                                >
                                  <option value="START">Start New Lehr</option>
                                  <option value="CONTINUE">Continue Existing Lehr</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        )}
                        {newProgressIntent === "START" ? (
                          <div className="col-md-6">
                            <label className="form-label" htmlFor="service-status">
                              Lehr Status
                            </label>
                            <select
                              className="form-select"
                              id="service-status"
                              name="status"
                              value={newStatus}
                              onChange={(event) => setNewStatus(event.target.value)}
                            >
                              <option value="IN_PROGRESS">In Progress</option>
                              <option value="FINISHED">Completed</option>
                            </select>
                          </div>
                        ) : (
                          <div className="col-md-6 d-flex align-items-end">
                            <div className="form-check mb-2">
                              <input
                                className="form-check-input"
                                id="service-completed"
                                type="checkbox"
                                checked={newCompleted}
                                onChange={(event) => setNewCompleted(event.target.checked)}
                              />
                              <label className="form-check-label" htmlFor="service-completed">
                                Completed
                              </label>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {kind === "Gebet" && (
                      <>
                        <div className="col-12">
                          <div className="alert alert-info mb-0">
                            <i className="bi bi-link-45deg me-2" />
                            {newMatch
                              ? `Continues The In-Progress Lehr Last Active ${newMatch.last_date}.`
                              : "No In-Progress Lehr Was Found. This Gebet Starts A New Lehr."}
                          </div>
                        </div>
                        <div className="col-md-6">
                          <div className="form-check mt-2">
                            <input
                              className="form-check-input"
                              id="service-linked-status"
                              type="checkbox"
                              checked={newCompleted}
                              onChange={(event) => setNewCompleted(event.target.checked)}
                            />
                            <label className="form-check-label" htmlFor="service-linked-status">
                              Completed
                            </label>
                          </div>
                        </div>
                      </>
                    )}
                    <div className="col-12">
                      <label className="form-label" htmlFor="service-notes">
                        Notes
                      </label>
                      <textarea
                        className="form-control"
                        id="service-notes"
                        name="notes"
                        rows={3}
                        placeholder="Notes For This Service"
                      />
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </button>
                  <button className="btn btn-primary" type="submit">
                    <i className="bi bi-check-lg me-1" />
                    Save Service
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div
          className="modal fade show d-block service-edit-modal"
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-service-title"
        >
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content card card-primary card-outline mb-0">
              <div className="modal-header">
                <div>
                  <small className="text-uppercase text-body-secondary">
                    Existing Register Entry
                  </small>
                  <h5 className="modal-title" id="edit-service-title">
                    Edit Service
                  </h5>
                </div>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close Editor"
                  onClick={() => setSelected(null)}
                />
              </div>
              <form key={selected.id} onSubmit={saveEdit}>
                <div className="modal-body">
                  {saveError && (
                    <div className="alert alert-danger" role="alert">
                      <i className="bi bi-exclamation-triangle-fill me-2" />
                      {saveError}
                    </div>
                  )}
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label" htmlFor="edit-service-date">
                        Date
                      </label>
                      <input
                        className="form-control"
                        id="edit-service-date"
                        name="editDate"
                        type="date"
                        defaultValue={selected.dateValue}
                        required
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" htmlFor="edit-service-type">
                        Service Type
                      </label>
                      <select
                        className="form-select"
                        id="edit-service-type"
                        name="editType"
                        value={editKind}
                        onChange={(event) =>
                          setEditKind(event.target.value as EntryType)
                        }
                        required
                      >
                        <option>Lehr</option>
                        <option>Gebet</option>
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" htmlFor="edit-service-song">
                        Song
                      </label>
                      <input
                        className="form-control"
                        id="edit-service-song"
                        name="editSong"
                        list="songs-list"
                        defaultValue={selected.song}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" htmlFor="edit-service-song-by">
                        Song By
                      </label>
                      <input
                        className="form-control"
                        id="edit-service-song-by"
                        name="editSongBy"
                        list="people-list"
                        defaultValue={selected.songBy}
                        placeholder="Choose Or Type A New Person"
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label" htmlFor="edit-service-text">
                        Text
                      </label>
                      <TextChoiceInput
                        id="edit-service-text"
                        name="editText"
                        defaultValue={selected.text}
                        choices={textChoices}
                        required
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" htmlFor="edit-service-text-by">
                        Text By
                      </label>
                      <input
                        className="form-control"
                        id="edit-service-text-by"
                        name="editTextBy"
                        list="people-list"
                        defaultValue={selected.textBy}
                        placeholder="Choose Or Type A New Person"
                      />
                    </div>
                    {editKind === "Lehr" && (
                      <>
                        <div className="col-md-6">
                          <label className="form-label" htmlFor="edit-service-vorrade">
                            Vorrade
                          </label>
                          <input
                            className="form-control"
                            id="edit-service-vorrade"
                            name="editVorrade"
                            list="vorraden-list"
                            defaultValue={selected.vorrade === "—" ? "" : selected.vorrade}
                          />
                        </div>
                        <div className="col-md-6">
                          <label className="form-label" htmlFor="edit-progress-intent">
                            Lehr Progress Choice
                          </label>
                          <select
                            className="form-select"
                            id="edit-progress-intent"
                            value={editProgressIntent}
                            onChange={(event) => {
                              setEditProgressIntent(event.target.value);
                              setEditStatusChanged(true);
                            }}
                          >
                            <option value="START">Start New Lehr</option>
                            <option value="CONTINUE">Continue Existing Lehr</option>
                          </select>
                        </div>
                        <div className="col-md-6">
                          <label className="form-label" htmlFor="edit-service-vorrade-by">
                            Vorrade By
                          </label>
                          <input
                            className="form-control"
                            id="edit-service-vorrade-by"
                            name="editVorradeBy"
                            list="people-list"
                            defaultValue={
                              selected.vorradeBy === "—" ? "" : selected.vorradeBy
                            }
                            placeholder="Choose Or Type A New Person"
                          />
                        </div>
                        {editProgressIntent === "START" ? (
                          <div className="col-12">
                            <div className="card bg-body-tertiary border-0 mb-0">
                              <div className="card-body d-flex flex-wrap align-items-center gap-3">
                                <span className="form-label mb-0">Lehr Status</span>
                                {editProgressStatus && (
                                  <span
                                    className={`badge ${statusBadgeClass(
                                      editProgressStatus === "FINISHED"
                                        ? "Completed"
                                        : "In Progress",
                                    )}`}
                                  >
                                    {editProgressStatus === "FINISHED"
                                      ? "Completed"
                                      : "In Progress"}
                                  </span>
                                )}
                                {!editProgressStatus && (
                                  <button
                                    className="btn btn-outline-warning btn-sm"
                                    type="button"
                                    onClick={() => {
                                      setEditProgressStatus("IN_PROGRESS");
                                      setEditStatusChanged(true);
                                    }}
                                  >
                                    Mark In Progress
                                  </button>
                                )}
                                {editProgressStatus !== "FINISHED" && (
                                  <button
                                    className="btn btn-success btn-sm"
                                    type="button"
                                    onClick={() => {
                                      setEditProgressStatus("FINISHED");
                                      setEditStatusChanged(true);
                                    }}
                                  >
                                    Mark Completed
                                  </button>
                                )}
                                {editProgressStatus === "FINISHED" && (
                                  <button
                                    className="btn btn-outline-warning btn-sm"
                                    type="button"
                                    onClick={() => {
                                      setEditProgressStatus("IN_PROGRESS");
                                      setEditStatusChanged(true);
                                    }}
                                  >
                                    Reopen Lehr
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="col-md-6 d-flex align-items-end">
                            <div className="form-check mb-2">
                              <input
                                className="form-check-input"
                                id="edit-service-completed"
                                type="checkbox"
                                checked={editCompleted}
                                onChange={(event) => {
                                  setEditCompleted(event.target.checked);
                                  setEditStatusChanged(true);
                                }}
                              />
                              <label
                                className="form-check-label fw-semibold"
                                htmlFor="edit-service-completed"
                              >
                                Completed
                              </label>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {editKind === "Gebet" && (
                      <>
                        <div className="col-12">
                          <div className="form-label">Lehr Progress</div>
                          {selected.linkedLehrId ? (
                            <div className="card bg-body-tertiary border-0 mb-0">
                              <div className="card-body py-2 px-3">
                                <strong>
                                  {selected.progressStartId === selected.id
                                    ? "Started Lehr"
                                    : "Continues Existing Lehr"}
                                </strong>
                                <span className="text-body-secondary ms-2">
                                  {selected.linkedLehrDate}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="alert alert-warning mb-0">
                              No Lehr Progress Is Linked To This Older Gebet.
                            </div>
                          )}
                          <div className="form-text">
                            Matching Uses The Newest In-Progress Lehr With The Same
                            Text And Activity Within Nine Months.
                          </div>
                        </div>
                        <div className="col-md-6">
                          <div className="form-check mt-4">
                            <input
                              className="form-check-input"
                              id="edit-service-linked-status"
                              type="checkbox"
                              checked={editCompleted}
                              onChange={(event) => {
                                setEditCompleted(event.target.checked);
                                setEditStatusChanged(true);
                              }}
                            />
                            <label
                              className="form-check-label fw-semibold"
                              htmlFor="edit-service-linked-status"
                            >
                              Completed
                            </label>
                          </div>
                        </div>
                      </>
                    )}
                    <div className={editKind === "Lehr" ? "col-md-6" : "col-12"}>
                      <label className="form-label" htmlFor="edit-service-notes">
                        Notes
                      </label>
                      <textarea
                        className="form-control"
                        id="edit-service-notes"
                        name="editNotes"
                        rows={3}
                        defaultValue={selected.notes}
                      />
                    </div>
                  </div>

                  {selected.progressStartId === selected.id &&
                    selected.progressHistory.length > 0 && (
                      <div className="card card-outline card-primary mt-4 mb-0">
                        <div className="card-header">
                          <h6 className="card-title mb-0">
                            <i className="bi bi-diagram-3 me-2" />
                            Lehr Progress
                          </h6>
                        </div>
                        <div className="list-group list-group-flush">
                          {selected.progressHistory.map((historyItem, index) => {
                            const historyService = items.find(
                              (service) => service.id === historyItem.id,
                            );
                            const role =
                              historyItem.role === "STARTED_LEHR"
                                ? "Started Lehr"
                                : historyItem.role === "CONTINUED"
                                  ? "Continued"
                                  : historyItem.role === "COMPLETED_LEHR"
                                    ? "Completed Lehr"
                                    : "";
                            return (
                              <button
                                className="list-group-item list-group-item-action d-flex flex-wrap align-items-center justify-content-between gap-2"
                                key={historyItem.id}
                                type="button"
                                onClick={() => historyService && openService(historyService)}
                              >
                                <span>
                                  <strong>
                                    {index === 0
                                      ? historyItem.type === "LEHR"
                                        ? "Lehr"
                                        : "Gebet"
                                      : historyItem.type === "LEHR"
                                        ? "Lehr Continuation"
                                        : "Gebet"}
                                  </strong>
                                  <span className="text-body-secondary ms-2">
                                    {new Date(`${historyItem.date}T12:00:00`).toLocaleDateString(
                                      "en-US",
                                      { month: "short", day: "numeric", year: "numeric" },
                                    )}
                                  </span>
                                </span>
                                {role && (
                                  <span className={`badge ${statusBadgeClass(role)}`}>
                                    {role}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  <div className="card bg-body-tertiary border-0 mt-4 mb-0">
                    <div className="card-body d-flex flex-wrap align-items-center justify-content-between gap-3">
                      <div>
                        <h6 className="mb-1">
                          <i className="bi bi-file-earmark-pdf me-2" />
                          PDF Attachments
                        </h6>
                        <small className="text-body-secondary">
                          Documents For This Service Stay Private.
                        </small>
                      </div>
                      <button className="btn btn-outline-primary btn-sm" type="button">
                        <i className="bi bi-plus-lg me-1" />
                        Add PDF
                      </button>
                    </div>
                  </div>
                </div>
                <div className="modal-footer justify-content-between">
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={deleteSelectedService}
                  >
                    <i className="bi bi-trash3 me-1" />
                    Delete Service
                  </button>
                  <div className="d-flex flex-wrap align-items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={() => setSelected(null)}
                    >
                      Cancel
                    </button>
                    <button className="btn btn-primary" type="submit">
                      <i className="bi bi-check-lg me-1" />
                      Save Changes
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {songEditor && (
        <div
          className="modal fade show d-block service-edit-modal library-editor-modal"
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="song-editor-title"
        >
          <div className="modal-dialog modal-fullscreen">
            <div className="modal-content card card-primary card-outline mb-0">
              <div className="modal-header">
                <div>
                  <small className="text-uppercase text-body-secondary">
                    Reusable Song Record
                  </small>
                  <h5 className="modal-title" id="song-editor-title">
                    {songEditor === "new" ? "Add Song" : "Edit Song"}
                  </h5>
                </div>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close Song Editor"
                  onClick={() => void closeSongEditor()}
                />
              </div>
              <form
                ref={songFormRef}
                key={songEditor === "new" ? "new" : songEditor.id}
                onSubmit={saveSong}
                onBlur={autoSaveSong}
              >
                <div className="modal-body">
                  <div className="library-editor-content">
                  {songError && (
                    <div className="alert alert-danger" role="alert">
                      <i className="bi bi-exclamation-triangle-fill me-2" />
                      {songError}
                    </div>
                  )}
                  <div className="row g-3">
                    <div className="col-12 col-lg-7">
                      <label className="form-label" htmlFor="song-title">
                        Title
                      </label>
                      <input
                        className="form-control"
                        id="song-title"
                        name="songTitle"
                        defaultValue={songEditor === "new" ? "" : songEditor.title}
                        placeholder="Include The Song Number In The Title"
                        required
                      />
                    </div>
                    <div className="col-12 col-lg-5">
                      <label className="form-label" htmlFor="song-tags">
                        Tags
                      </label>
                      <input
                        className="form-control"
                        id="song-tags"
                        name="songTags"
                        defaultValue={songEditor === "new" ? "" : songEditor.tags}
                        placeholder="Christmas, Faith, Easter"
                      />
                      <div className="form-text">
                        Separate Multiple Tags With Commas.
                      </div>
                    </div>
                    <div className="col-12">
                      <label className="form-label" htmlFor="song-notes">
                        Notes
                      </label>
                      <textarea
                        className="form-control"
                        id="song-notes"
                        name="songNotes"
                        rows={9}
                        defaultValue={songEditor === "new" ? "" : songEditor.notes}
                        placeholder="Notes About This Song"
                      />
                    </div>
                    {songEditor !== "new" && (
                      <div className="col-12">
                        <div className="card bg-body-tertiary border-0 mb-0">
                          <div className="card-body d-flex flex-wrap gap-4 py-3">
                            <span>
                              <strong>{songEditor.timesUsed}</strong>
                              <span className="text-body-secondary ms-2">Times Used</span>
                            </span>
                            <span>
                              <strong>{songEditor.lastUsed}</strong>
                              <span className="text-body-secondary ms-2">Last Used</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  </div>
                </div>
                <div className="modal-footer justify-content-between">
                  <small className="text-body-secondary">
                    {songEditor === "new"
                      ? "Save This New Song Once To Start Automatic Saving."
                      : songAutoSaveStatus || "Changes Save Automatically."}
                  </small>
                  <div className="d-flex flex-wrap align-items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={() => void closeSongEditor()}
                    >
                      Close
                    </button>
                    {songEditor === "new" && (
                      <button className="btn btn-primary" type="submit">
                        <i className="bi bi-check-lg me-1" />
                        Save Song
                      </button>
                    )}
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {tagManagerOpen && (
        <div
          className="modal fade show d-block service-edit-modal tag-manager-modal"
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tag-manager-title"
        >
          <div className="modal-dialog modal-fullscreen-md-down modal-xl">
            <div className="modal-content card card-primary card-outline mb-0">
              <div className="modal-header">
                <div>
                  <small className="text-uppercase text-body-secondary">Sermon Library</small>
                  <h5 className="modal-title" id="tag-manager-title">Manage Tags</h5>
                </div>
                <button
                  className="btn-close"
                  type="button"
                  aria-label="Close Tag Manager"
                  onClick={() => setTagManagerOpen(false)}
                />
              </div>
              <div className="modal-body">
                {tagManagerError && (
                  <div className="alert alert-danger" role="alert">
                    <i className="bi bi-exclamation-triangle-fill me-2" />
                    {tagManagerError}
                  </div>
                )}
                <div className="input-group mb-3">
                  <span className="input-group-text"><i className="bi bi-search" /></span>
                  <input
                    className="form-control"
                    value={tagManagerQuery}
                    onChange={(event) => setTagManagerQuery(event.target.value)}
                    placeholder="Search Tags"
                    aria-label="Search Managed Tags"
                  />
                </div>
                <div className="table-responsive">
                  <table className="table table-hover align-middle tag-manager-table">
                    <thead className="table-light">
                      <tr>
                        <th>Tag</th>
                        <th className="text-center">Sermons</th>
                        <th className="text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {managedTags.map((tag) => (
                        <tr key={tag.id}>
                          <td>
                            {tagRenameId === tag.id ? (
                              <div className="input-group">
                                <input
                                  className="form-control"
                                  value={tagRenameValue}
                                  onChange={(event) => setTagRenameValue(event.target.value)}
                                  aria-label={`Rename ${tag.name}`}
                                />
                                <button
                                  className="btn btn-primary"
                                  type="button"
                                  onClick={() => void renameTag(tag.id)}
                                >
                                  Save
                                </button>
                                <button
                                  className="btn btn-outline-secondary"
                                  type="button"
                                  onClick={() => setTagRenameId("")}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : tagMergeId === tag.id ? (
                              <div className="input-group">
                                <span className="input-group-text">Merge Into</span>
                                <select
                                  className="form-select"
                                  value={tagMergeTargetId}
                                  onChange={(event) => setTagMergeTargetId(event.target.value)}
                                  aria-label={`Merge ${tag.name} Into`}
                                >
                                  <option value="">Choose Tag</option>
                                  {tags
                                    .filter((target) => target.id !== tag.id)
                                    .sort((left, right) => left.name.localeCompare(right.name))
                                    .map((target) => (
                                      <option value={target.id} key={target.id}>{target.name}</option>
                                    ))}
                                </select>
                                <button
                                  className="btn btn-primary"
                                  type="button"
                                  onClick={() => void mergeTag(tag.id)}
                                >
                                  Merge
                                </button>
                                <button
                                  className="btn btn-outline-secondary"
                                  type="button"
                                  onClick={() => setTagMergeId("")}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <span className="badge text-bg-primary-subtle border fs-6">{tag.name}</span>
                            )}
                          </td>
                          <td className="text-center">{tag.sermonCount}</td>
                          <td className="text-end">
                            {tagRenameId !== tag.id && tagMergeId !== tag.id && (
                              <div className="btn-group btn-group-sm">
                                <button
                                  className="btn btn-outline-primary"
                                  type="button"
                                  onClick={() => {
                                    setTagMergeId("");
                                    setTagRenameId(tag.id);
                                    setTagRenameValue(tag.name);
                                  }}
                                >
                                  Rename
                                </button>
                                <button
                                  className="btn btn-outline-secondary"
                                  type="button"
                                  disabled={tags.length < 2}
                                  onClick={() => {
                                    setTagRenameId("");
                                    setTagMergeId(tag.id);
                                    setTagMergeTargetId("");
                                  }}
                                >
                                  Merge
                                </button>
                                <button
                                  className="btn btn-outline-danger"
                                  type="button"
                                  onClick={() => void deleteTag(tag)}
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!managedTags.length && (
                  <div className="text-center text-body-secondary py-5">
                    No Tags Match Your Search.
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <small className="text-body-secondary me-auto">
                  Unused Tags Stay Here Until You Delete Them.
                </small>
                <button
                  className="btn btn-outline-secondary"
                  type="button"
                  onClick={() => setTagManagerOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {textEditor && (
        <div
          className="modal fade show d-block service-edit-modal library-editor-modal"
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="text-editor-title"
        >
          <div className="modal-dialog modal-fullscreen">
            <div className="modal-content card card-primary card-outline mb-0">
              <div className="modal-header">
                <div>
                  <small className="text-uppercase text-body-secondary">
                    Reusable Text Record
                  </small>
                  <h5 className="modal-title" id="text-editor-title">
                    {textEditor === "new" ? "Add Text" : "Edit Text"}
                  </h5>
                </div>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close Text Editor"
                  onClick={() => void closeTextEditor()}
                />
              </div>
              <form
                ref={textFormRef}
                key={textEditor === "new" ? "new" : textEditor.id}
                onSubmit={saveText}
                onBlur={autoSaveText}
              >
                <div className="modal-body">
                  <div className="library-editor-content">
                  {textError && (
                    <div className="alert alert-danger" role="alert">
                      <i className="bi bi-exclamation-triangle-fill me-2" />
                      {textError}
                    </div>
                  )}
                  <div className="row g-3">
                    <div className="col-12 col-lg-4">
                      <label className="form-label" htmlFor="text-text">
                        Text
                      </label>
                      <input
                        className="form-control"
                        id="text-text"
                        name="textText"
                        defaultValue={textEditor === "new" ? "" : textEditor.text}
                        placeholder="Text Name"
                        required
                      />
                    </div>
                    <div className="col-12 col-lg-8">
                      <label className="form-label" htmlFor="text-description">
                        Description
                      </label>
                      <input
                        className="form-control"
                        id="text-description"
                        name="textDescription"
                        defaultValue={
                          textEditor === "new" ? "" : textEditor.description
                        }
                        placeholder="Description Of This Text"
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label" htmlFor="text-tags-picker">Tags</label>
                      <TagPicker
                        tags={tags}
                        selected={textEditorTags}
                        onChange={changeTextEditorTags}
                      />
                    </div>
                    <div className="col-12 col-lg-6">
                      <label
                        className="form-label"
                        htmlFor="text-scripture-reference"
                      >
                        Scripture Reference
                      </label>
                      <textarea
                        className="form-control"
                        id="text-scripture-reference"
                        name="textScriptureReference"
                        rows={5}
                        defaultValue={
                          textEditor === "new"
                            ? ""
                            : textEditor.scriptureReference
                        }
                        placeholder="For Example, John 3:16"
                      />
                    </div>
                    <div className="col-12 col-lg-6">
                      <label
                        className="form-label"
                        htmlFor="text-songs-for-text"
                      >
                        Songs For This Sermon
                      </label>
                      <textarea
                        className="form-control"
                        id="text-songs-for-text"
                        name="textSongsForText"
                        rows={5}
                        defaultValue={
                          textEditor === "new" ? "" : textEditor.songsForText
                        }
                        placeholder="Songs For This Sermon"
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label" htmlFor="text-notes">
                        Notes
                      </label>
                      <textarea
                        className="form-control"
                        id="text-notes"
                        name="textNotes"
                        rows={6}
                        defaultValue={textEditor === "new" ? "" : textEditor.notes}
                        placeholder="Notes About This Text"
                      />
                    </div>
                    {textEditor !== "new" && (
                      <div className="col-12">
                        <div className="card bg-body-tertiary border-0 mb-0">
                          <div className="card-body d-flex flex-wrap gap-4 py-3">
                            <span>
                              <strong>{textEditor.timesUsed}</strong>
                              <span className="text-body-secondary ms-2">
                                Times Used
                              </span>
                            </span>
                            <span>
                              <strong>{textEditor.lastUsed}</strong>
                              <span className="text-body-secondary ms-2">
                                Last Used
                              </span>
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="col-12">
                      <div className="card border mb-0">
                        <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
                          <div>
                            <h6 className="mb-0">
                              <i className="bi bi-file-earmark-pdf me-2" />
                              Private PDF Attachments
                            </h6>
                            <small className="text-body-secondary">
                              Add More Than One PDF To This Text.
                            </small>
                          </div>
                          {textEditor !== "new" && (
                            <label
                              className={`btn btn-outline-primary btn-sm mb-0 ${
                                pdfUploading ? "disabled" : ""
                              }`}
                            >
                              <i className="bi bi-plus-lg me-1" />
                              {pdfUploading ? "Adding PDFs..." : "Add PDFs"}
                              <input
                                className="visually-hidden"
                                type="file"
                                accept="application/pdf,.pdf"
                                multiple
                                disabled={pdfUploading}
                                onChange={uploadTextPdfs}
                              />
                            </label>
                          )}
                        </div>
                        <div className="list-group list-group-flush">
                          {textEditor === "new" ? (
                            <div className="list-group-item text-body-secondary py-3">
                              Save The Text Before Adding PDFs.
                            </div>
                          ) : textAttachments.length ? (
                            textAttachments.map((attachment) => (
                              <div
                                className="list-group-item d-flex flex-wrap align-items-center justify-content-between gap-2"
                                key={attachment.id}
                              >
                                <div className="min-width-0">
                                  <strong className="d-block text-truncate">
                                    {attachment.original_file_name}
                                  </strong>
                                  <small className="text-body-secondary">
                                    {formatFileSize(attachment.byte_size)}
                                  </small>
                                </div>
                                <div className="btn-group btn-group-sm" role="group">
                                  <a
                                    className="btn btn-outline-primary"
                                    href={`${textAttachmentsApiUrl()}?fileId=${encodeURIComponent(attachment.id)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open
                                  </a>
                                  <a
                                    className="btn btn-outline-secondary"
                                    href={`${textAttachmentsApiUrl()}?fileId=${encodeURIComponent(attachment.id)}&download=1`}
                                  >
                                    Download
                                  </a>
                                  <button
                                    className="btn btn-outline-danger"
                                    type="button"
                                    onClick={() => removeTextAttachment(attachment)}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="list-group-item text-body-secondary py-3">
                              No PDFs Attached Yet.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  </div>
                </div>
                <div
                  className={`modal-footer ${
                    textEditor !== "new" ? "justify-content-between" : ""
                  }`}
                >
                  {textEditor !== "new" &&
                    (textEditor.serviceCount === 0 ? (
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={deleteText}
                      >
                        <i className="bi bi-trash3 me-1" />
                        Delete Text
                      </button>
                    ) : (
                      <small className="text-body-secondary">
                        Used Texts Cannot Be Deleted.
                      </small>
                    ))}
                  <div className="d-flex flex-wrap align-items-center gap-2">
                    <small className="text-body-secondary align-self-center me-2">
                      {textEditor === "new"
                        ? "Save This New Text Once To Start Automatic Saving."
                        : textAutoSaveStatus || "Changes Save Automatically."}
                    </small>
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={() => void closeTextEditor()}
                    >
                      Close
                    </button>
                    {textEditor === "new" && (
                      <button className="btn btn-primary" type="submit">
                        <i className="bi bi-check-lg me-1" />
                        Save Text
                      </button>
                    )}
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <datalist id="songs-list">
        {songChoices.map((song) => (
          <option key={song.id} value={song.title}>
            {song.tags}
          </option>
        ))}
      </datalist>
      <datalist id="people-list">
        {peopleChoices.map((person) => (
          <option key={person.id} value={person.name} />
        ))}
      </datalist>
      <datalist id="texts-list">
        {textChoices.map((record) => (
          <option key={record.id} value={record.text}>
            {record.description}
          </option>
        ))}
      </datalist>
      <datalist id="vorraden-list" />
    </div>
  );
}
