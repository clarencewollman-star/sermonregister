"use client";

/* eslint-disable @next/next/no-img-element */

import {
  ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import ReactCrop, { type PercentCrop } from "react-image-crop";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
} from "pdfjs-dist";

let pdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

function loadPdfJs() {
  pdfJsPromise ||= import("pdfjs-dist").then((pdfJs) => {
    pdfJs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    return pdfJs;
  });
  return pdfJsPromise;
}

export type TextAttachment = {
  id: string;
  text_id: string;
  original_file_name: string;
  display_name: string;
  mime_type: string;
  byte_size: number;
  display_byte_size: number | null;
  sort_order: number;
  crop_json: string | null;
  rotation_degrees: number;
  last_page: number;
  last_offset: number;
  created_at: string;
  updated_at: string;
};

type PhotoDraft = {
  id: string;
  file: File;
  sourceBlob: Blob;
  sourceUrl: string;
  displayName: string;
  crop: PercentCrop;
  rotation: number;
  error: string;
  existingId?: string;
};

type Props = {
  textId: string;
  textName: string;
  attachments: TextAttachment[];
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onAttachmentsChange: (attachments: TextAttachment[]) => void;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
};

const apiUrl = "/api/text-attachments";
const fullCrop: PercentCrop = { unit: "%", x: 0, y: 0, width: 100, height: 100 };
const subscribeToClient = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function BodyPortal({ children }: { children: ReactNode }) {
  const isClient = useSyncExternalStore(
    subscribeToClient,
    getClientSnapshot,
    getServerSnapshot,
  );

  return isClient ? createPortal(children, document.body) : null;
}

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function bufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return window.btoa(binary);
}

function photoMime(file: File) {
  const type = file.type.toLowerCase();
  if (type === "image/jpg") return "image/jpeg";
  if (["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(type)) {
    return type;
  }
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension === "heic"
    ? "image/heic"
    : extension === "heif"
      ? "image/heif"
      : extension === "png"
        ? "image/png"
        : extension === "webp"
          ? "image/webp"
          : "image/jpeg";
}

function photoName(textName: string, number: number) {
  const date = new Date().toLocaleDateString("en-CA");
  const safeText = textName.trim() || "Text";
  return `${safeText} - Notes - ${date} - ${number}.jpg`;
}

async function imageElement(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function canvasBlob(canvas: HTMLCanvasElement, quality = 0.86) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could Not Prepare Photo."))),
      "image/jpeg",
      quality,
    );
  });
}

async function rotatePhoto(blob: Blob) {
  const image = await imageElement(blob);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalHeight;
  canvas.height = image.naturalWidth;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could Not Rotate Photo.");
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(Math.PI / 2);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  return canvasBlob(canvas, 0.92);
}

async function optimizedPhoto(blob: Blob, crop: PercentCrop) {
  const image = await imageElement(blob);
  const sourceX = Math.round((crop.x / 100) * image.naturalWidth);
  const sourceY = Math.round((crop.y / 100) * image.naturalHeight);
  const sourceWidth = Math.max(1, Math.round((crop.width / 100) * image.naturalWidth));
  const sourceHeight = Math.max(1, Math.round((crop.height / 100) * image.naturalHeight));
  const maximum = 2400;
  const scale = Math.min(1, maximum / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could Not Prepare Photo.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvasBlob(canvas);
}

async function compatiblePhoto(file: File) {
  const type = photoMime(file);
  if (type !== "image/heic" && type !== "image/heif") return file as Blob;
  const { heicTo } = await import("heic-to");
  return heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
}

function PdfCanvas({
  document,
  pageNumber,
  scale = 1,
  thumbnail = false,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  scale?: number;
  thumbnail?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    const render = async () => {
      const page = await document.getPage(pageNumber);
      if (cancelled || !canvasRef.current || !wrapperRef.current) return;
      const base = page.getViewport({ scale: 1 });
      const available = thumbnail ? 92 : Math.max(280, wrapperRef.current.clientWidth - 16);
      const viewScale = (available / base.width) * scale;
      const viewport = page.getViewport({ scale: viewScale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      renderTask = page.render({
        canvasContext: context,
        canvas,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      await renderTask.promise;
    };
    void render().catch(() => undefined);
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, scale, thumbnail]);

  return (
    <div className={thumbnail ? "attachment-pdf-thumb" : "attachment-pdf-page"} ref={wrapperRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}

function PdfThumbnail({ attachment }: { attachment: TextAttachment }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    void loadPdfJs()
      .then((pdfJs) => {
        if (cancelled) return null;
        task = pdfJs.getDocument({
          url: `${apiUrl}?fileId=${encodeURIComponent(attachment.id)}`,
        });
        return task.promise;
      })
      .then((nextDocument) => {
        if (!cancelled && nextDocument) setDocument(nextDocument);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [attachment.id]);
  return document ? (
    <PdfCanvas document={document} pageNumber={1} thumbnail />
  ) : (
    <span className="attachment-thumb-placeholder">
      <i className="bi bi-file-earmark-pdf" />
    </span>
  );
}

function PhotoReview({
  drafts,
  setDrafts,
  onClose,
  onSaved,
}: {
  drafts: PhotoDraft[];
  setDrafts: React.Dispatch<React.SetStateAction<PhotoDraft[]>>;
  onClose: () => void;
  onSaved: (draft: PhotoDraft, display: Blob) => Promise<void>;
}) {
  const [activeId, setActiveId] = useState(drafts[0]?.id || "");
  const [saving, setSaving] = useState(false);
  const active = drafts.find((draft) => draft.id === activeId) || drafts[0];

  useEffect(() => {
    if (!drafts.some((draft) => draft.id === activeId)) {
      setActiveId(drafts[0]?.id || "");
    }
  }, [activeId, drafts]);

  async function rotateActive() {
    if (!active) return;
    try {
      const nextBlob = await rotatePhoto(active.sourceBlob);
      const nextUrl = URL.createObjectURL(nextBlob);
      URL.revokeObjectURL(active.sourceUrl);
      setDrafts((current) =>
        current.map((draft) =>
          draft.id === active.id
            ? {
                ...draft,
                sourceBlob: nextBlob,
                sourceUrl: nextUrl,
                crop: fullCrop,
                rotation: (draft.rotation + 90) % 360,
                error: "",
              }
            : draft,
        ),
      );
    } catch (error) {
      setDrafts((current) =>
        current.map((draft) =>
          draft.id === active.id
            ? { ...draft, error: error instanceof Error ? error.message : "Could Not Rotate Photo." }
            : draft,
        ),
      );
    }
  }

  async function saveRemaining() {
    setSaving(true);
    for (const draft of [...drafts]) {
      try {
        const display = await optimizedPhoto(draft.sourceBlob, draft.crop);
        await onSaved(draft, display);
        URL.revokeObjectURL(draft.sourceUrl);
        setDrafts((current) => current.filter((item) => item.id !== draft.id));
      } catch (error) {
        setDrafts((current) =>
          current.map((item) =>
            item.id === draft.id
              ? { ...item, error: error instanceof Error ? error.message : "Could Not Save Photo." }
              : item,
          ),
        );
      }
    }
    setSaving(false);
  }

  if (!active) return null;
  return (
    <div className="attachment-review" role="dialog" aria-modal="true" aria-label="Review Photos">
      <header className="attachment-review-header">
        <div>
          <h2 className="h5 mb-0">Review Photos</h2>
          <small>{drafts.length} Remaining</small>
        </div>
        <button className="btn btn-outline-secondary" type="button" onClick={onClose} disabled={saving}>
          Cancel
        </button>
      </header>
      <div className="attachment-review-body">
        <div className="attachment-review-strip" aria-label="Selected Photos">
          {drafts.map((draft, index) => (
            <button
              className={`attachment-review-choice ${draft.id === active.id ? "active" : ""}`}
              key={draft.id}
              type="button"
              onClick={() => setActiveId(draft.id)}
            >
              <img src={draft.sourceUrl} alt="" />
              <span>{index + 1}</span>
              {draft.error && <i className="bi bi-exclamation-circle-fill text-danger" />}
            </button>
          ))}
        </div>
        <div className="attachment-crop-workspace">
          <ReactCrop
            crop={active.crop}
            onChange={(_, percentCrop) =>
              setDrafts((current) =>
                current.map((draft) =>
                  draft.id === active.id ? { ...draft, crop: percentCrop, error: "" } : draft,
                ),
              )
            }
          >
            <img src={active.sourceUrl} alt="Crop Preview" />
          </ReactCrop>
        </div>
        <div className="attachment-review-controls">
          <div className="flex-grow-1">
            <label className="form-label" htmlFor="attachment-photo-name">Photo Name</label>
            <input
              id="attachment-photo-name"
              className="form-control"
              value={active.displayName}
              onChange={(event) =>
                setDrafts((current) =>
                  current.map((draft) =>
                    draft.id === active.id ? { ...draft, displayName: event.target.value } : draft,
                  ),
                )
              }
            />
            {active.error && <div className="text-danger small mt-2">{active.error}</div>}
          </div>
          <button className="btn btn-outline-primary" type="button" onClick={() => void rotateActive()}>
            <i className="bi bi-arrow-clockwise me-1" />Rotate
          </button>
          <button
            className="btn btn-outline-secondary"
            type="button"
            onClick={() =>
              setDrafts((current) =>
                current.map((draft) => draft.id === active.id ? { ...draft, crop: fullCrop } : draft),
              )
            }
          >
            Reset Crop
          </button>
        </div>
      </div>
      <footer className="attachment-review-footer">
        <span className="text-body-secondary small">Successful Photos Stay Saved If Another Photo Fails.</span>
        <button className="btn btn-primary" type="button" onClick={() => void saveRemaining()} disabled={saving}>
          {saving ? "Saving Photos..." : drafts.some((draft) => draft.error) ? "Retry Remaining" : "Save Photos"}
        </button>
      </footer>
    </div>
  );
}

function AttachmentViewer({
  attachments,
  initialId,
  onClose,
  onPosition,
}: {
  attachments: TextAttachment[];
  initialId: string;
  onClose: () => void;
  onPosition: (id: string, page: number, offset: number) => Promise<void>;
}) {
  const [index, setIndex] = useState(Math.max(0, attachments.findIndex((item) => item.id === initialId)));
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [documentAttachmentId, setDocumentAttachmentId] = useState("");
  const [scale, setScale] = useState(1);
  const [page, setPage] = useState(
    () => attachments[Math.max(0, attachments.findIndex((item) => item.id === initialId))]?.last_page || 1,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const attachment = attachments[index];

  useEffect(() => {
    const pageBody = window.document.body;
    const previousOverflow = pageBody.style.overflow;
    pageBody.style.overflow = "hidden";
    return () => {
      pageBody.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (attachment.mime_type !== "application/pdf") return;
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    void loadPdfJs()
      .then((pdfJs) => {
        if (cancelled) return null;
        task = pdfJs.getDocument({
          url: `${apiUrl}?fileId=${encodeURIComponent(attachment.id)}`,
        });
        return task.promise;
      })
      .then((nextDocument) => {
        if (!cancelled && nextDocument) {
          setDocument(nextDocument);
          setDocumentAttachmentId(attachment.id);
        }
      })
      .catch(() => {
        if (!cancelled) setDocument(null);
      });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [attachment]);

  useEffect(() => {
    if (!document || !scrollRef.current) return;
    const timer = window.setTimeout(() => {
      const target = scrollRef.current?.querySelector<HTMLElement>(
        `[data-page="${Math.min(attachment.last_page || 1, document.numPages)}"]`,
      );
      if (target && scrollRef.current) {
        scrollRef.current.scrollTop = target.offsetTop + target.offsetHeight * (attachment.last_offset || 0);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [attachment.last_offset, attachment.last_page, document]);

  const readingPosition = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller || attachment.mime_type !== "application/pdf") return { page: 1, offset: 0 };
    const elements = Array.from(scroller.querySelectorAll<HTMLElement>("[data-page]"));
    let current = elements[0];
    for (const element of elements) {
      if (element.offsetTop <= scroller.scrollTop + 24) current = element;
    }
    if (!current) return { page: 1, offset: 0 };
    const offset = Math.max(0, Math.min(1, (scroller.scrollTop - current.offsetTop) / current.offsetHeight));
    return { page: Number(current.dataset.page || 1), offset };
  }, [attachment.mime_type]);

  function saveAndClose() {
    const position = readingPosition();
    onClose();
    void onPosition(attachment.id, position.page, position.offset).catch(() => undefined);
  }

  async function move(next: number) {
    const position = readingPosition();
    await onPosition(attachment.id, position.page, position.offset).catch(() => undefined);
    setScale(1);
    setPage(attachments[next].last_page || 1);
    setIndex(next);
  }

  return (
    <div className="attachment-viewer" role="dialog" aria-modal="true" aria-label={attachment.display_name}>
      <header className="attachment-viewer-toolbar">
        <button className="btn btn-outline-light" type="button" onClick={saveAndClose}>
          <i className="bi bi-arrow-left me-1" />Back To Text
        </button>
        <div className="attachment-viewer-title">
          <strong>{attachment.display_name}</strong>
          <small>{index + 1} Of {attachments.length}</small>
        </div>
        <div className="attachment-viewer-actions">
          {attachment.mime_type === "application/pdf" && (
            <>
              <button className="btn btn-outline-light" type="button" onClick={() => setScale((value) => Math.max(0.6, value - 0.2))} aria-label="Zoom Out">
                <i className="bi bi-zoom-out" />
              </button>
              <button className="btn btn-outline-light" type="button" onClick={() => setScale(1)}>Fit Width</button>
              <button className="btn btn-outline-light" type="button" onClick={() => setScale((value) => Math.min(2.4, value + 0.2))} aria-label="Zoom In">
                <i className="bi bi-zoom-in" />
              </button>
            </>
          )}
          <a className="btn btn-outline-light" href={`${apiUrl}?fileId=${encodeURIComponent(attachment.id)}&download=1`}>
            <i className="bi bi-download" />
          </a>
        </div>
      </header>
      <div
        className="attachment-viewer-content"
        ref={scrollRef}
        onScroll={(event) => {
          const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-page]"));
          let current = elements[0];
          for (const element of elements) {
            if (element.offsetTop <= event.currentTarget.scrollTop + event.currentTarget.clientHeight * 0.35) current = element;
          }
          if (current) setPage(Number(current.dataset.page || 1));
        }}
      >
        {attachment.mime_type === "application/pdf" ? (
          document && documentAttachmentId === attachment.id ? (
            Array.from({ length: document.numPages }, (_, pageIndex) => (
              <div data-page={pageIndex + 1} key={pageIndex + 1}>
                <PdfCanvas document={document} pageNumber={pageIndex + 1} scale={scale} />
              </div>
            ))
          ) : (
            <div className="attachment-viewer-loading">Loading PDF...</div>
          )
        ) : (
          <div className="attachment-photo-view">
            <img src={`${apiUrl}?fileId=${encodeURIComponent(attachment.id)}&view=1&v=${encodeURIComponent(attachment.updated_at)}`} alt={attachment.display_name} />
          </div>
        )}
      </div>
      <footer className="attachment-viewer-footer">
        <button className="btn btn-outline-light" type="button" disabled={index === 0} onClick={() => void move(index - 1)}>
          <i className="bi bi-chevron-left me-1" />Previous Attachment
        </button>
        <span>
          {attachment.mime_type === "application/pdf" &&
          document && documentAttachmentId === attachment.id
            ? `Page ${page} Of ${document.numPages}`
            : attachment.mime_type === "application/pdf"
              ? "Loading PDF"
              : "Photo"}
        </span>
        <button className="btn btn-outline-light" type="button" disabled={index === attachments.length - 1} onClick={() => void move(index + 1)}>
          Next Attachment<i className="bi bi-chevron-right ms-1" />
        </button>
      </footer>
    </div>
  );
}

export default function TextAttachmentManager({
  textId,
  textName,
  attachments,
  busy,
  setBusy,
  onAttachmentsChange,
  onRefresh,
  onError,
}: Props) {
  const [photoDrafts, setPhotoDrafts] = useState<PhotoDraft[]>([]);
  const [viewerId, setViewerId] = useState("");

  async function uploadPdfFiles(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    if (!files.length) return;
    setBusy(true);
    onError("");
    const errors: string[] = [];
    for (const file of files) {
      try {
        if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} Is Larger Than 25 MB.`);
        if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
          throw new Error(`${file.name} Is Not A PDF File.`);
        }
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            textId,
            fileName: file.name,
            displayName: file.name,
            mimeType: "application/pdf",
            data: bufferToBase64(await file.arrayBuffer()),
          }),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(result.error || `Could Not Add ${file.name}.`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `Could Not Add ${file.name}.`);
      }
    }
    input.value = "";
    await onRefresh();
    setBusy(false);
    if (errors.length) onError(errors.join(" "));
  }

  async function choosePhotos(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files || []).slice(0, 20);
    input.value = "";
    if (!files.length) return;
    setBusy(true);
    onError("");
    const next: PhotoDraft[] = [];
    for (const [index, file] of files.entries()) {
      try {
        if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} Is Larger Than 25 MB.`);
        const sourceBlob = await compatiblePhoto(file);
        next.push({
          id: crypto.randomUUID(),
          file,
          sourceBlob,
          sourceUrl: URL.createObjectURL(sourceBlob),
          displayName: photoName(textName, attachments.length + index + 1),
          crop: fullCrop,
          rotation: 0,
          error: "",
        });
      } catch (error) {
        onError(error instanceof Error ? error.message : `Could Not Read ${file.name}.`);
      }
    }
    setPhotoDrafts(next);
    setBusy(false);
  }

  async function savePhoto(draft: PhotoDraft, display: Blob) {
    const payload = {
      id: draft.existingId,
      action: "PHOTO_EDIT",
      textId,
      fileName: draft.file.name,
      displayName: draft.displayName,
      mimeType: photoMime(draft.file),
      data: bufferToBase64(await draft.file.arrayBuffer()),
      displayMimeType: "image/jpeg",
      displayData: bufferToBase64(await display.arrayBuffer()),
      crop: draft.crop,
      rotation: draft.rotation,
    };
    const response = await fetch(apiUrl, {
      method: draft.existingId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(result.error || `Could Not Save ${draft.displayName}.`);
    await onRefresh();
  }

  async function rename(attachment: TextAttachment) {
    const displayName = window.prompt("Attachment Name", attachment.display_name)?.trim();
    if (!displayName || displayName === attachment.display_name) return;
    const response = await fetch(apiUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: attachment.id, action: "RENAME", displayName }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) return onError(result.error || "Could Not Rename Attachment.");
    await onRefresh();
  }

  async function reorder(attachment: TextAttachment, direction: -1 | 1) {
    const currentIndex = attachments.findIndex((item) => item.id === attachment.id);
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= attachments.length) return;
    const next = [...attachments];
    [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
    onAttachmentsChange(next);
    const response = await fetch(apiUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ textId, action: "REORDER", ids: next.map((item) => item.id) }),
    });
    const result = (await response.json()) as TextAttachment[] & { error?: string };
    if (!response.ok) {
      onAttachmentsChange(attachments);
      return onError(result.error || "Could Not Reorder Attachments.");
    }
    onAttachmentsChange(result);
  }

  async function editPhoto(attachment: TextAttachment) {
    setBusy(true);
    onError("");
    try {
      const response = await fetch(`${apiUrl}?fileId=${encodeURIComponent(attachment.id)}&original=1`);
      if (!response.ok) throw new Error("Could Not Load The Original Photo.");
      const blob = await response.blob();
      const file = new File([blob], attachment.original_file_name, { type: attachment.mime_type });
      const sourceBlob = await compatiblePhoto(file);
      setPhotoDrafts([{
        id: crypto.randomUUID(),
        file,
        sourceBlob,
        sourceUrl: URL.createObjectURL(sourceBlob),
        displayName: attachment.display_name,
        crop: fullCrop,
        rotation: 0,
        error: "",
        existingId: attachment.id,
      }]);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could Not Edit Photo.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(attachment: TextAttachment) {
    if (!window.confirm(`Permanently Remove ${attachment.display_name}? This Cannot Be Undone Except By Restoring A Backup.`)) return;
    const response = await fetch(apiUrl, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: attachment.id }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) return onError(result.error || "Could Not Remove Attachment.");
    await onRefresh();
  }

  async function savePosition(id: string, lastPage: number, lastOffset: number) {
    const response = await fetch(apiUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "POSITION", lastPage, lastOffset }),
    });
    if (response.ok) {
      onAttachmentsChange(
        attachments.map((item) => item.id === id ? { ...item, last_page: lastPage, last_offset: lastOffset } : item),
      );
    }
  }

  const viewerAttachments = useMemo(() => attachments, [attachments]);

  return (
    <>
      <div className="card border mb-0 attachment-manager-card">
        <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
          <div>
            <h6 className="mb-0"><i className="bi bi-paperclip me-2" />Private Attachments</h6>
            <small className="text-body-secondary">Keep PDFs And Photos With This Text.</small>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <label className={`btn btn-outline-primary btn-sm mb-0 ${busy ? "disabled" : ""}`}>
              <i className="bi bi-file-earmark-pdf me-1" />Add PDFs
              <input className="visually-hidden" type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={uploadPdfFiles} />
            </label>
            <label className={`btn btn-primary btn-sm mb-0 ${busy ? "disabled" : ""}`}>
              <i className="bi bi-camera me-1" />Take Photo
              <input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" capture="environment" multiple disabled={busy} onChange={choosePhotos} />
            </label>
            <label className={`btn btn-outline-primary btn-sm mb-0 ${busy ? "disabled" : ""}`}>
              <i className="bi bi-images me-1" />Choose Photos
              <input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" multiple disabled={busy} onChange={choosePhotos} />
            </label>
          </div>
        </div>
        <div className="list-group list-group-flush attachment-list">
          {attachments.length ? attachments.map((attachment, index) => (
            <div className="list-group-item attachment-list-item" key={attachment.id}>
              <button className="attachment-thumbnail" type="button" onClick={() => setViewerId(attachment.id)} aria-label={`View ${attachment.display_name}`}>
                {attachment.mime_type === "application/pdf" ? (
                  <PdfThumbnail attachment={attachment} />
                ) : (
                  <img src={`${apiUrl}?fileId=${encodeURIComponent(attachment.id)}&view=1&v=${encodeURIComponent(attachment.updated_at)}`} alt="" />
                )}
              </button>
              <button className="attachment-details" type="button" onClick={() => setViewerId(attachment.id)}>
                <strong>{attachment.display_name}</strong>
                <small>
                  {attachment.mime_type === "application/pdf" ? "PDF" : "Photo"} · {formatBytes(attachment.byte_size)}
                  {attachment.last_page > 1 ? ` · Resume At Page ${attachment.last_page}` : ""}
                </small>
              </button>
              <div className="attachment-item-actions">
                <button className="btn btn-sm btn-outline-primary" type="button" onClick={() => setViewerId(attachment.id)}>View</button>
                <button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => void rename(attachment)}>Rename</button>
                {attachment.mime_type !== "application/pdf" && (
                  <button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => void editPhoto(attachment)}>Crop / Rotate</button>
                )}
                <button className="btn btn-sm btn-outline-secondary" type="button" disabled={index === 0} onClick={() => void reorder(attachment, -1)} aria-label="Move Up"><i className="bi bi-arrow-up" /></button>
                <button className="btn btn-sm btn-outline-secondary" type="button" disabled={index === attachments.length - 1} onClick={() => void reorder(attachment, 1)} aria-label="Move Down"><i className="bi bi-arrow-down" /></button>
                <button className="btn btn-sm btn-outline-danger" type="button" onClick={() => void remove(attachment)}>Remove</button>
              </div>
            </div>
          )) : (
            <div className="list-group-item text-body-secondary py-3">No Attachments Yet.</div>
          )}
        </div>
      </div>
      {photoDrafts.length > 0 && (
        <BodyPortal>
          <PhotoReview
            drafts={photoDrafts}
            setDrafts={setPhotoDrafts}
            onClose={() => {
              photoDrafts.forEach((draft) => URL.revokeObjectURL(draft.sourceUrl));
              setPhotoDrafts([]);
            }}
            onSaved={savePhoto}
          />
        </BodyPortal>
      )}
      {viewerId && viewerAttachments.some((item) => item.id === viewerId) && (
        <BodyPortal>
          <AttachmentViewer
            attachments={viewerAttachments}
            initialId={viewerId}
            onClose={() => setViewerId("")}
            onPosition={savePosition}
          />
        </BodyPortal>
      )}
    </>
  );
}
