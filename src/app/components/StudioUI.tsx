import { useId, useRef, type ReactNode } from "react";
import { Upload } from "lucide-react";
export function UploadZone({
  accept,
  onFile,
  children,
  label = "Choose file",
}: {
  accept: string;
  onFile: (file: File) => void;
  children?: ReactNode;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null),
    id = useId();
  return (
    <div
      className="studio-upload"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      <Upload size={28} aria-hidden="true" />
      <p>{children}</p>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => ref.current?.click()}
      >
        {label}
      </button>
      <input
        ref={ref}
        id={id}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
    </div>
  );
}
export function Status({
  error,
  children,
}: {
  error?: string | null;
  children?: ReactNode;
}) {
  return error ? (
    <p className="studio-status is-error" role="alert">
      {error}
    </p>
  ) : (
    <div className="studio-status" role="status" aria-live="polite">
      {children}
    </div>
  );
}
export async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText)
    throw new Error(
      "Clipboard unavailable. Use the download or select the value.",
    );
  await navigator.clipboard.writeText(value);
}
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Keep the URL alive until the browser has consumed the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
