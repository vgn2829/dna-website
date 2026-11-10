import { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload,
  Download,
  X,
  CircleDot,
  Repeat,
  Maximize2,
  Loader2,
  AlertTriangle,
  Info,
} from "lucide-react";
import { useVectorize } from "./svg-converter/useVectorize";
import { PRESETS, type PresetId } from "./svg-converter/presets";
import { JobOwner, dimensions } from "../lib/studio/jobs";
import { prepareSvg, svgImageUrl } from "../lib/studio/svg";
import type { TracerConfig } from "./svg-converter/types";
import { StudioRange } from "./studio/StudioRange";

const MAX_DIM = 1000;

export function SvgConverter() {
  const jobs = useRef(new JobOwner());
  const pendingRasterUrls = useRef(new Set<string>());
  function releaseRasterUrl(url: string) {
    pendingRasterUrls.current.delete(url);
    URL.revokeObjectURL(url);
  }
  function cancelJobs() {
    jobs.current.cancel();
    for (const url of pendingRasterUrls.current) URL.revokeObjectURL(url);
    pendingRasterUrls.current.clear();
  }
  useEffect(() => () => cancelJobs(), []);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mode, setMode] = useState<"toSvg" | "toRaster">("toSvg");

  // ── Image → SVG state ──────────────────────────────────────────────
  const [traceEngine, setTraceEngine] = useState<"line" | "vector">("line");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [svgData, setSvgData] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [threshold, setThreshold] = useState(128);
  const [useFill, setUseFill] = useState(false);
  const [useInvert, setUseInvert] = useState(false);
  const [useDilate, setUseDilate] = useState(false);
  const [rectCount, setRectCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Mirrors traceEngine for the async callbacks below (img.onload, the
  // awaited vectorize() promise): both run uncancelled, so if the user
  // switches engines while one is in flight, its late result must not
  // overwrite the other engine's now-displayed output.
  const traceEngineRef = useRef(traceEngine);
  useEffect(() => {
    traceEngineRef.current = traceEngine;
  }, [traceEngine]);

  // ── Vector Trace (VTracer) state ─────────────────────────────────────
  const [preset, setPreset] = useState<PresetId>("photo");
  const [tracerBinary, setTracerBinary] = useState(false);
  const [tracerPathMode, setTracerPathMode] =
    useState<TracerConfig["mode"]>("spline");
  const [tracerFilterSpeckle, setTracerFilterSpeckle] = useState(
    PRESETS.photo.filterSpeckle,
  );
  const [tracerCornerThreshold, setTracerCornerThreshold] = useState(
    PRESETS.photo.cornerThreshold,
  );
  const [tracerColorPrecision, setTracerColorPrecision] = useState(
    PRESETS.photo.colorPrecision,
  );
  const [shapeCount, setShapeCount] = useState(0);
  const {
    status: vectorizeStatus,
    error: vectorizeError,
    vectorize,
    reset: resetVectorize,
  } = useVectorize();

  const switchEngine = (engine: "line" | "vector") => {
    cancelJobs();
    resetVectorize();
    setIsProcessing(false);
    setIsRasterizing(false);
    setTraceEngine(engine);
    setSvgData(null);
    setRectCount(0);
    setShapeCount(0);
  };

  const applyPreset = (id: PresetId) => {
    setPreset(id);
    const p = PRESETS[id];
    setTracerBinary(p.binary);
    setTracerPathMode(p.mode);
    setTracerFilterSpeckle(p.filterSpeckle);
    setTracerCornerThreshold(p.cornerThreshold);
    setTracerColorPrecision(p.colorPrecision);
  };

  // ── SVG → raster state ─────────────────────────────────────────────
  const [svgText, setSvgText] = useState<string | null>(null);
  const [svgDims, setSvgDims] = useState<{ w: number; h: number } | null>(null);
  const [rasterUrl, setRasterUrl] = useState<string | null>(null);
  const [rasterInfo, setRasterInfo] = useState<{
    w: number;
    h: number;
    size: string;
    format: string;
  } | null>(null);
  const [rasterFormat, setRasterFormat] = useState<"image/png" | "image/jpeg">(
    "image/png",
  );
  const [rasterQuality, setRasterQuality] = useState(92);
  const [rasterScale, setRasterScale] = useState(100);
  const [isRasterizing, setIsRasterizing] = useState(false);
  const svgFileRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    },
    [imageUrl],
  );
  useEffect(
    () => () => {
      if (rasterUrl) URL.revokeObjectURL(rasterUrl);
    },
    [rasterUrl],
  );

  useEffect(() => {
    cancelJobs();
    setIsRasterizing(false);
    setRasterUrl(null);
    setRasterInfo(null);
  }, [rasterFormat, rasterQuality, rasterScale]);
  useEffect(() => {
    cancelJobs();
    resetVectorize();
    setIsProcessing(false);
    setSvgData(null);
  }, [
    threshold,
    useFill,
    useInvert,
    useDilate,
    preset,
    tracerBinary,
    tracerPathMode,
    tracerFilterSpeckle,
    tracerCornerThreshold,
    tracerColorPrecision,
    resetVectorize,
  ]);
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/") || file.size > 25 * 1024 * 1024) {
        setFileError("Choose an image under 25 MB.");
        return;
      }
      cancelJobs();
      setIsProcessing(false);
      setFileError(null);
      setImageUrl(URL.createObjectURL(file));
      setSvgData(null);
      setRectCount(0);
      setShapeCount(0);
      resetVectorize();
    }
  };

  const processImage = useCallback(() => {
    if (!imageUrl || !canvasRef.current) return;
    const id = jobs.current.next();
    setIsProcessing(true);
    setFileError(null);
    setTimeout(() => {
      if (!jobs.current.current(id) || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const img = new Image();
      img.onload = () => {
        if (!jobs.current.current(id)) return;
        try {
          let w = img.width,
            h = img.height;
          if (Math.max(w, h) > MAX_DIM) {
            const scale = MAX_DIM / Math.max(w, h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }
          canvas.width = w;
          canvas.height = h;
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const data = ctx.getImageData(0, 0, w, h).data;

          const edgePixels: [number, number][] = [];
          const allDarkPixels: [number, number][] = [];
          for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
              const idx = (y * w + x) * 4;
              const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
              const isDark = useInvert ? gray >= threshold : gray < threshold;
              if (isDark) {
                allDarkPixels.push([x, y]);
                const nb = (dx: number, dy: number) => {
                  const nIdx = ((y + dy) * w + (x + dx)) * 4;
                  const ng = (data[nIdx] + data[nIdx + 1] + data[nIdx + 2]) / 3;
                  return useInvert ? ng < threshold : ng >= threshold;
                };
                if (nb(-1, 0) || nb(1, 0) || nb(0, -1) || nb(0, 1))
                  edgePixels.push([x, y]);
              }
            }
          }

          let pixels = useFill ? allDarkPixels : edgePixels;
          if (useDilate && !useFill) {
            const set = new Set<string>();
            for (const [x, y] of pixels) {
              for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) set.add(`${x + dx},${y + dy}`);
            }
            pixels = Array.from(set).map(
              (k) => k.split(",").map(Number) as [number, number],
            );
          }

          const rects = pixels.map(
            ([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1"/>`,
          );
          const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="white"/><g fill="black">${rects.join("")}</g></svg>`;
          setIsProcessing(false);
          // The user may have switched to Vector Trace while this was in
          // flight — don't let a late result overwrite its output.
          if (traceEngineRef.current !== "line") return;
          setRectCount(rects.length);
          setSvgData(svg);
        } catch (err) {
          setFileError((err as Error).message);
          setIsProcessing(false);
        }
      };
      img.onerror = () => {
        if (jobs.current.current(id)) {
          setIsProcessing(false);
          setFileError("Could not decode image.");
        }
      };
      img.src = imageUrl;
    }, 10);
  }, [imageUrl, threshold, useFill, useInvert, useDilate]);

  const vectorizeImage = useCallback(() => {
    if (!imageUrl || !canvasRef.current) return;
    const id = jobs.current.next();
    setIsProcessing(true);
    setFileError(null);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const img = new Image();
    img.onload = async () => {
      if (!jobs.current.current(id)) return;
      try {
        let w = img.width,
          h = img.height;
        if (Math.max(w, h) > MAX_DIM) {
          const scale = MAX_DIM / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        canvas.width = w;
        canvas.height = h;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);

        const config: TracerConfig = {
          binary: tracerBinary,
          mode: tracerPathMode,
          hierarchical: "stacked",
          filterSpeckle: tracerFilterSpeckle,
          colorPrecision: tracerColorPrecision,
          layerDifference: PRESETS[preset].layerDifference,
          cornerThreshold: tracerCornerThreshold,
          lengthThreshold: PRESETS[preset].lengthThreshold,
          spliceThreshold: PRESETS[preset].spliceThreshold,
          maxIterations: PRESETS[preset].maxIterations,
          pathPrecision: PRESETS[preset].pathPrecision,
        };

        const svg = await vectorize(imageData, config);
        // The user may have switched to Line Trace while this was in
        // flight — don't let a late result overwrite its output.
        if (!jobs.current.current(id) || traceEngineRef.current !== "vector")
          return;
        setSvgData(svg);
        setShapeCount((svg.match(/<(path|polygon|rect)[\s>]/g) ?? []).length);
      } catch (err) {
        if (jobs.current.current(id)) setFileError((err as Error).message);
      } finally {
        if (jobs.current.current(id)) setIsProcessing(false);
      }
    };
    img.onerror = () => {
      if (jobs.current.current(id)) {
        setIsProcessing(false);
        setFileError("Could not decode image.");
      }
    };
    img.src = imageUrl;
  }, [
    imageUrl,
    tracerBinary,
    tracerPathMode,
    tracerFilterSpeckle,
    tracerCornerThreshold,
    tracerColorPrecision,
    preset,
    vectorize,
  ]);

  const downloadSvg = () => {
    if (!svgData) return;
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      traceEngine === "vector" ? "vector-trace.svg" : "line-drawing.svg";
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    cancelJobs();
    setIsProcessing(false);
    resetVectorize();
    setFileError(null);
    setImageUrl(null);
    setSvgData(null);
    setRectCount(0);
    setShapeCount(0);
    resetVectorize();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── SVG → raster handlers ──────────────────────────────────────────
  const handleSvgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setFileError("Choose an SVG under 10 MB.");
      return;
    }
    const id = jobs.current.next();
    setIsRasterizing(false);
    const reader = new FileReader();
    reader.onload = () => {
      if (!jobs.current.current(id)) return;
      try {
        const prepared = prepareSvg(String(reader.result));
        setSvgText(prepared.text);
        setSvgDims({ w: prepared.w, h: prepared.h });
        setFileError(null);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "Invalid SVG");
        return;
      }
      if (rasterUrl) URL.revokeObjectURL(rasterUrl);
      setRasterUrl(null);
      setRasterInfo(null);
    };
    reader.onerror = () => {
      if (jobs.current.current(id)) setFileError("Could not read SVG.");
    };
    reader.readAsText(file);
  };

  const rasterize = useCallback(() => {
    if (!svgText || !canvasRef.current) return;
    const id = jobs.current.next();
    setIsRasterizing(true);
    setFileError(null);
    const dims = svgDims || { w: 1024, h: 1024 };
    const w = Math.max(1, Math.round((dims.w * rasterScale) / 100));
    const h = Math.max(1, Math.round((dims.h * rasterScale) / 100));
    try {
      dimensions(w, h);
    } catch (err) {
      setIsRasterizing(false);
      setFileError((err as Error).message);
      return;
    }
    // Normalise the SVG to explicit pixel dimensions so browsers that ignore a
    // bare viewBox (0×0 intrinsic size) still rasterise at the intended scale.
    let normalized = svgText;
    try {
      const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
      const el = doc.querySelector("svg");
      if (el) {
        el.setAttribute("width", String(w));
        el.setAttribute("height", String(h));
        normalized = new XMLSerializer().serializeToString(el);
      }
    } catch {
      /* keep original markup */
    }
    const blob = new Blob([normalized], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    pendingRasterUrls.current.add(url);
    const img = new Image();
    img.onload = () => {
      if (!jobs.current.current(id) || !canvasRef.current) {
        releaseRasterUrl(url);
        return;
      }
      try {
        const canvas = canvasRef.current;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, w, h);
        // JPEG has no alpha channel — flatten transparency onto white so it
        // doesn't render as black.
        if (rasterFormat === "image/jpeg") {
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, w, h);
        }
        ctx.drawImage(img, 0, 0, w, h);
        releaseRasterUrl(url);
        const q = rasterFormat === "image/png" ? 1 : rasterQuality / 100;
        canvas.toBlob(
          (b) => {
            if (!jobs.current.current(id)) return;
            if (!b) {
              setIsRasterizing(false);
              setFileError("Image encoding failed. Try a smaller scale.");
              return;
            }
            setRasterUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return URL.createObjectURL(b);
            });
            setRasterInfo({
              w,
              h,
              size: (b.size / 1024).toFixed(1),
              format: b.type,
            });
            setIsRasterizing(false);
          },
          rasterFormat,
          q,
        );
      } catch (err) {
        releaseRasterUrl(url);
        if (jobs.current.current(id)) {
          setIsRasterizing(false);
          setFileError((err as Error).message);
        }
      }
    };
    img.onerror = () => {
      releaseRasterUrl(url);
      if (jobs.current.current(id)) {
        setIsRasterizing(false);
        setFileError("Could not render SVG.");
      }
    };
    img.src = url;
  }, [svgText, svgDims, rasterScale, rasterFormat, rasterQuality]);

  const downloadRaster = () => {
    if (!rasterUrl) return;
    const a = document.createElement("a");
    a.href = rasterUrl;
    a.download = `image.${rasterInfo?.format === "image/jpeg" ? "jpg" : "png"}`;
    a.click();
  };

  const resetRaster = () => {
    cancelJobs();
    setIsRasterizing(false);
    setFileError(null);
    setSvgText(null);
    setSvgDims(null);
    if (rasterUrl) URL.revokeObjectURL(rasterUrl);
    setRasterUrl(null);
    setRasterInfo(null);
    if (svgFileRef.current) svgFileRef.current.value = "";
  };

  const lineBusy = traceEngine === "line" ? isProcessing : vectorizeStatus === "processing";
  // One labelled, wrapping choice group (DNA .segmented with aria-pressed).
  const choice = <V extends string | boolean>(
    id: string,
    label: string,
    value: V,
    options: [V, string][],
    onPick: (v: V) => void,
  ) => (
    <div className="studio-group" role="group" aria-labelledby={id}>
      <span className="studio-label" id={id}>
        {label}
      </span>
      <div className="segmented studio-choice">
        {options.map(([v, l]) => (
          <button
            key={String(v)}
            className="segmented-item"
            aria-pressed={value === v}
            onClick={() => onPick(v)}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
  const switchMode = (next: "toSvg" | "toRaster") => {
    cancelJobs();
    resetVectorize();
    setIsProcessing(false);
    setIsRasterizing(false);
    setMode(next);
  };

  return (
    <div className="studio-tool">
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {fileError && (
        <p role="alert" className="studio-status is-error">
          {fileError}
        </p>
      )}

      <div className="segmented" role="group" aria-label="Conversion direction" style={{ alignSelf: "flex-start" }}>
        <button
          className="segmented-item"
          onClick={() => switchMode("toSvg")}
          aria-pressed={mode === "toSvg"}
        >
          Image → SVG
        </button>
        <button
          className="segmented-item"
          onClick={() => switchMode("toRaster")}
          aria-pressed={mode === "toRaster"}
        >
          SVG → Image
        </button>
      </div>

      {mode === "toSvg" ? (
        !imageUrl ? (
          <label className="studio-upload is-clickable" style={{ minHeight: 300 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={handleFileUpload}
            />
            <Upload size={32} aria-hidden="true" />
            <p>Select an image (high-contrast works best)</p>
            <button
              className="btn-secondary"
              type="button"
              onClick={(e) => {
                e.preventDefault();
                fileInputRef.current?.click();
              }}
            >
              Browse files
            </button>
          </label>
        ) : (
          <>
            <div className="studio-previews">
              <section className="studio-panel">
                <h2>Original</h2>
                <div className="studio-panel-stage">
                  <img src={imageUrl} alt="Original" />
                </div>
              </section>
              <section className="studio-panel">
                <h2>SVG Output</h2>
                <div className="studio-panel-stage" aria-busy={lineBusy}>
                  {lineBusy ? (
                    <Loader2 size={26} className="animate-spin" aria-label="Processing" />
                  ) : svgData ? (
                    <img
                      className="studio-svg-preview"
                      src={svgImageUrl(svgData)}
                      alt="Generated SVG output"
                    />
                  ) : (
                    <span>No output yet</span>
                  )}
                </div>
              </section>
            </div>

            {traceEngine === "line" && rectCount > 40000 && (
              <div className="studio-notice has-icon" role="status">
                <AlertTriangle size={15} aria-hidden="true" />
                <span>
                  Large output ({rectCount.toLocaleString()} shapes). The SVG
                  may be slow to open. Try a higher threshold or a simpler
                  image.
                </span>
              </div>
            )}

            {traceEngine === "vector" && vectorizeError && (
              <div className="studio-notice has-icon studio-tone is-fail" role="alert">
                <AlertTriangle size={15} aria-hidden="true" />
                <span>Vectorize failed: {vectorizeError}</span>
              </div>
            )}

            {traceEngine === "vector" && (
              <div className="studio-notice has-icon">
                <Info size={15} aria-hidden="true" />
                <span>
                  Runs on your device — the image never leaves it. Vector Trace
                  works best on{" "}
                  <strong>logos, line art, and flat-color images</strong>.
                  Photos with gradients or soft shadows will look posterized or
                  produce many small shapes — try <strong>Line Trace</strong>{" "}
                  for pure line-art photos, or simplify the source image first.
                </span>
              </div>
            )}

            <div className="studio-controls">
              {choice("svg-engine", "Trace engine", traceEngine, [["line", "Line Trace"], ["vector", "Vector Trace"]], switchEngine)}

              {traceEngine === "line" ? (
                <div className="studio-ranges">
                  <StudioRange
                    label="Threshold"
                    ariaLabel="Threshold"
                    min={0}
                    max={255}
                    value={threshold}
                    onChange={setThreshold}
                  />
                  <div className="studio-group" role="group" aria-labelledby="svg-effects">
                    <span className="studio-label" id="svg-effects">
                      Effects
                    </span>
                    <div className="studio-inline">
                      <button
                        className="btn-translucent btn-icon"
                        aria-pressed={useFill}
                        aria-label="Fill dark areas"
                        onClick={() => setUseFill(!useFill)}
                        title="Fill"
                      >
                        <CircleDot size={18} aria-hidden="true" />
                      </button>
                      <button
                        className="btn-translucent btn-icon"
                        aria-pressed={useInvert}
                        aria-label="Invert threshold"
                        onClick={() => setUseInvert(!useInvert)}
                        title="Invert"
                      >
                        <Repeat size={18} aria-hidden="true" />
                      </button>
                      <button
                        className="btn-translucent btn-icon"
                        aria-pressed={useDilate}
                        aria-label="Thicken edges"
                        onClick={() => setUseDilate(!useDilate)}
                        title="Thicken"
                      >
                        <Maximize2 size={18} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {choice("svg-preset", "Preset", preset, [["photo", "Photo"], ["lineArt", "Line Art"], ["pixelArt", "Pixel Art"]], applyPreset)}
                  <div className="studio-toolbar" style={{ alignItems: "flex-start" }}>
                    {choice("svg-colour-mode", "Color mode", tracerBinary, [[false, "Color"], [true, "Binary"]], setTracerBinary)}
                    {choice("svg-path-style", "Path style", tracerPathMode, [["spline", "Spline"], ["polygon", "Polygon"], ["pixel", "Pixel"]], setTracerPathMode)}
                  </div>
                  <details className="studio-disclosure">
                    <summary>Advanced</summary>
                    <div className="studio-ranges" style={{ marginTop: 8 }}>
                      <StudioRange
                        label="Speckle filter"
                        ariaLabel="Speckle filter"
                        min={0}
                        max={32}
                        value={tracerFilterSpeckle}
                        onChange={setTracerFilterSpeckle}
                      />
                      <StudioRange
                        label="Corner threshold"
                        ariaLabel="Corner threshold"
                        min={0}
                        max={180}
                        value={tracerCornerThreshold}
                        suffix="°"
                        onChange={setTracerCornerThreshold}
                      />
                      <StudioRange
                        label="Color precision"
                        ariaLabel="Colour precision"
                        min={0}
                        max={7}
                        value={tracerColorPrecision}
                        onChange={setTracerColorPrecision}
                      />
                    </div>
                  </details>
                  {svgData && shapeCount > 0 && (
                    <span className="studio-value" style={{ textAlign: "left" }}>
                      {shapeCount.toLocaleString()} shapes
                    </span>
                  )}
                </>
              )}

              <div className="studio-actions studio-media-actions">
                {traceEngine === "line" ? (
                  <button
                    className="btn-primary is-grow"
                    onClick={processImage}
                    disabled={isProcessing}
                  >
                    {isProcessing ? "Processing…" : "Convert to SVG"}
                  </button>
                ) : (
                  <button
                    className="btn-primary is-grow"
                    onClick={vectorizeImage}
                    disabled={isProcessing || vectorizeStatus === "processing"}
                  >
                    {vectorizeStatus === "processing"
                      ? "Vectorizing…"
                      : "Vectorize"}
                  </button>
                )}
                {svgData && (
                  <button className="btn-translucent" onClick={downloadSvg}>
                    <Download size={16} aria-hidden="true" /> Download
                  </button>
                )}
                <button
                  className="btn-translucent btn-icon"
                  onClick={reset}
                  title="Reset"
                  aria-label="Reset"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </>
        )
      ) : !svgText ? (
        <label className="studio-upload is-clickable" style={{ minHeight: 300 }}>
          <input
            ref={svgFileRef}
            type="file"
            accept=".svg"
            hidden
            onChange={handleSvgUpload}
          />
          <Upload size={32} aria-hidden="true" />
          <p>Select an SVG file to rasterize</p>
          <button
            className="btn-secondary"
            type="button"
            onClick={(e) => {
              e.preventDefault();
              svgFileRef.current?.click();
            }}
          >
            Browse files
          </button>
        </label>
      ) : (
        <>
          <div className="studio-previews">
            <section className="studio-panel">
              <h2>
                SVG Input
                {svgDims && (
                  <span className="studio-panel-meta">
                    {svgDims.w}×{svgDims.h}
                  </span>
                )}
              </h2>
              <div className="studio-panel-stage">
                <img
                  className="studio-svg-preview"
                  src={svgImageUrl(svgText)}
                  alt="SVG input"
                />
              </div>
            </section>
            <section className="studio-panel">
              <h2>
                Raster Output
                {rasterInfo && (
                  <span className="studio-panel-meta">
                    {rasterInfo.w}×{rasterInfo.h} · {rasterInfo.size}KB
                  </span>
                )}
              </h2>
              <div className="studio-panel-stage" aria-busy={isRasterizing}>
                {isRasterizing ? (
                  <Loader2 size={26} className="animate-spin" aria-label="Rendering" />
                ) : rasterUrl ? (
                  <img src={rasterUrl} alt="Raster output" />
                ) : (
                  <span>No output yet</span>
                )}
              </div>
            </section>
          </div>

          <div className="studio-controls">
            <div className="studio-toolbar" style={{ alignItems: "flex-start" }}>
              {choice("svg-raster-format", "Format", rasterFormat, [["image/png", "PNG"], ["image/jpeg", "JPG"]], setRasterFormat)}
            </div>
            <div className="studio-ranges">
              {rasterFormat === "image/jpeg" && (
                <StudioRange
                  label="Quality"
                  ariaLabel="Raster quality"
                  min={10}
                  max={100}
                  value={rasterQuality}
                  suffix="%"
                  onChange={setRasterQuality}
                />
              )}
              <StudioRange
                label="Scale"
                ariaLabel="Raster scale"
                min={10}
                max={400}
                value={rasterScale}
                suffix="%"
                onChange={setRasterScale}
              />
            </div>
            <div className="studio-actions studio-media-actions">
              <button
                className="btn-primary is-grow"
                onClick={rasterize}
                disabled={isRasterizing}
              >
                {isRasterizing ? "Rendering…" : "Convert to Image"}
              </button>
              {rasterUrl && (
                <button className="btn-translucent" onClick={downloadRaster}>
                  <Download size={16} aria-hidden="true" /> Download
                </button>
              )}
              <button
                className="btn-translucent btn-icon"
                onClick={resetRaster}
                title="Reset"
                aria-label="Reset"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
