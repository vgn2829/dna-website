import { useState, useRef, useEffect } from "react";
import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  RenderTask,
} from "pdfjs-dist";
import {
  JobOwner,
  dimensions,
  loadImage,
  canvasBlob,
} from "../../lib/studio/jobs";
import { UploadZone, Status } from "../StudioUI";
interface Source {
  url: string;
  w: number;
  h: number;
  name: string;
  size: number;
}
interface Output {
  url: string;
  preview: string;
  w: number;
  h: number;
  size: number;
  ext: string;
  config: string;
}
export function ImageConverter() {
  const [source, setSource] = useState<Source | null>(null),
    [output, setOutput] = useState<Output | null>(null);
  const [format, setFormat] = useState("image/png"),
    [quality, setQuality] = useState(92),
    [scale, setScale] = useState(100);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(0);
  const jobs = useRef(new JobOwner()),
    doc = useRef<PDFDocumentProxy | null>(null),
    loading = useRef<PDFDocumentLoadingTask | null>(null),
    render = useRef<RenderTask | null>(null);
  const config = JSON.stringify([format, quality, scale, page]);
  const stop = () => {
    jobs.current.cancel();
    render.current?.cancel();
    render.current = null;
  };
  const destroy = () => {
    stop();
    void loading.current?.destroy().catch(() => {});
    loading.current = null;
    doc.current = null;
  };
  useEffect(() => () => destroy(), []);
  useEffect(
    () => () => {
      if (source?.url.startsWith("blob:")) URL.revokeObjectURL(source.url);
    },
    [source],
  );
  useEffect(
    () => () => {
      if (output) URL.revokeObjectURL(output.url);
    },
    [output],
  );
  const reset = () => {
    destroy();
    setSource(null);
    setOutput(null);
    setPages(0);
    setPage(1);
    setBusy(false);
    setError(null);
  };
  const pdfPage = async (d: PDFDocumentProxy, n: number, id: number) => {
    const p = await d.getPage(n);
    if (!jobs.current.current(id)) throw new Error("Cancelled PDF rendering.");
    const viewport = p.getViewport({ scale: 2 });
    const size = dimensions(viewport.width, viewport.height);
    const c = document.createElement("canvas");
    c.width = size.w;
    c.height = size.h;
    const task = p.render({
      canvas: c,
      canvasContext: c.getContext("2d")!,
      viewport,
    });
    render.current = task;
    await task.promise;
    return { url: c.toDataURL("image/png"), ...size };
  };
  async function loadFile(file: File) {
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      setError("Choose a supported image or PDF.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError("Choose a file under 25 MB.");
      return;
    }
    destroy();
    const id = jobs.current.next();
    setBusy(true);
    setError(null);
    setOutput(null);
    setSource(null);
    setPages(0);
    setPage(1);
    let url: string | undefined;
    try {
      if (file.type === "application/pdf") {
        const pdfjs = await import("pdfjs-dist");
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        if (!jobs.current.current(id)) return;
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const bytes = await file.arrayBuffer();
        if (!jobs.current.current(id)) return;
        const task = pdfjs.getDocument({ data: bytes });
        loading.current = task;
        const d = await task.promise;
        if (!jobs.current.current(id)) {
          void task.destroy().catch(() => {});
          return;
        }
        doc.current = d;
        const result = await pdfPage(d, 1, id);
        if (!jobs.current.current(id)) return;
        setPages(d.numPages);
        setSource({ ...result, name: file.name, size: file.size });
      } else {
        url = URL.createObjectURL(file);
        const img = await loadImage(url);
        dimensions(img.naturalWidth, img.naturalHeight);
        if (!jobs.current.current(id)) {
          URL.revokeObjectURL(url);
          return;
        }
        setSource({
          url,
          w: img.naturalWidth,
          h: img.naturalHeight,
          name: file.name,
          size: file.size,
        });
        url = undefined;
      }
    } catch (err) {
      if (jobs.current.current(id))
        setError((err as Error).message || "Could not read file.");
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (jobs.current.current(id)) setBusy(false);
    }
  }
  async function gotoPage(n: number) {
    if (!doc.current || !source || n < 1 || n > pages) return;
    stop();
    const id = jobs.current.next();
    setBusy(true);
    setError(null);
    setOutput(null);
    try {
      const result = await pdfPage(doc.current, n, id);
      if (jobs.current.current(id)) {
        setSource({ ...source, ...result });
        setPage(n);
      }
    } catch (err) {
      if (jobs.current.current(id)) setError((err as Error).message);
    } finally {
      if (jobs.current.current(id)) setBusy(false);
    }
  }
  async function convert() {
    if (!source || busy) return;
    const id = jobs.current.next();
    setBusy(true);
    setError(null);
    try {
      const img = await loadImage(source.url);
      if (!jobs.current.current(id)) return;
      const { w, h } = dimensions(
        Math.max(1, Math.round((source.w * scale) / 100)),
        Math.max(1, Math.round((source.h * scale) / 100)),
      );
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      if (format === "image/jpeg") {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(img, 0, 0, w, h);
      let blob: Blob, ext: string;
      if (format === "application/pdf") {
        const { jsPDF } = await import("jspdf");
        if (!jobs.current.current(id)) return;
        const pdf = new jsPDF({
          orientation: w > h ? "landscape" : "portrait",
          unit: "px",
          format: [w, h],
        });
        pdf.addImage(c.toDataURL("image/png"), "PNG", 0, 0, w, h);
        blob = pdf.output("blob");
        ext = "pdf";
      } else {
        blob = await canvasBlob(c, format, quality / 100);
        ext =
          blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1] || "png";
      }
      if (!jobs.current.current(id)) return;
      const preview = c.toDataURL("image/png");
      setOutput({
        url: URL.createObjectURL(blob),
        preview,
        w,
        h,
        size: blob.size,
        ext,
        config,
      });
    } catch (err) {
      if (jobs.current.current(id)) setError((err as Error).message);
    } finally {
      if (jobs.current.current(id)) setBusy(false);
    }
  }
  return (
    <div className="studio-tool">
      <Status error={error}>{busy ? "Processing…" : ""}</Status>
      {!source && (
        <UploadZone accept="image/*,application/pdf" onFile={loadFile}>
          PNG, JPEG, WebP, GIF, BMP, SVG or PDF · up to 25 MB. All processing
          stays on your device.
        </UploadZone>
      )}
      {source && (
        <>
          <div className="studio-previews">
            {[
              {
                label: "Original",
                url: source.url,
                w: source.w,
                h: source.h,
                size: source.size,
              },
              {
                label: "Output",
                url: output?.preview,
                w: output?.w,
                h: output?.h,
                size: output?.size,
              },
            ].map((p) => (
              <section className="studio-panel" key={p.label}>
                <h2>{p.label}</h2>
                {p.url ? (
                  <>
                    <img src={p.url} alt={p.label} />
                    <p>
                      {p.w} × {p.h}px · {((p.size || 0) / 1024).toFixed(1)} KB
                    </p>
                  </>
                ) : (
                  <p>Configure output and choose Convert.</p>
                )}
              </section>
            ))}
          </div>
          <div className="studio-toolbar">
            <label className="studio-field">
              Format
              <select
                className="input-base"
                value={format}
                disabled={busy}
                onChange={(e) => setFormat(e.target.value)}
              >
                {[
                  ["image/png", "PNG"],
                  ["image/jpeg", "JPEG"],
                  ["image/webp", "WebP"],
                  ["application/pdf", "PDF"],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {["image/jpeg", "image/webp"].includes(format) && (
              <label className="studio-field">
                Quality {quality}%
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={quality}
                  disabled={busy}
                  onChange={(e) => setQuality(+e.target.value)}
                />
              </label>
            )}
            <label className="studio-field">
              Scale {scale}%
              <input
                type="range"
                min={10}
                max={200}
                value={scale}
                disabled={busy}
                onChange={(e) => setScale(+e.target.value)}
              />
            </label>
            {pages > 1 && (
              <div className="studio-inline">
                <button
                  className="btn-secondary"
                  aria-label="Previous PDF page"
                  disabled={busy || page <= 1}
                  onClick={() => gotoPage(page - 1)}
                >
                  ‹
                </button>
                <span>
                  Page {page}/{pages}
                </span>
                <button
                  className="btn-secondary"
                  aria-label="Next PDF page"
                  disabled={busy || page >= pages}
                  onClick={() => gotoPage(page + 1)}
                >
                  ›
                </button>
              </div>
            )}
            <button className="btn-primary" onClick={convert} disabled={busy}>
              Convert
            </button>
            <button className="btn-secondary" onClick={reset}>
              {busy ? "Cancel and clear" : "Clear input"}
            </button>
            {output && output.config === config && (
              <a
                className="btn-primary"
                href={output.url}
                download={`converted.${output.ext}`}
              >
                Download {output.ext.toUpperCase()}
              </a>
            )}
          </div>
          {output && output.config !== config && (
            <p role="status">
              Settings changed. Convert again to download the updated output.
            </p>
          )}
        </>
      )}
      {busy && !source && (
        <button className="btn-secondary" onClick={reset}>
          Cancel
        </button>
      )}
    </div>
  );
}
