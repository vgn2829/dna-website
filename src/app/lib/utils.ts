import * as React from "react"
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Requests a resized/recompressed version of a Supabase Storage image.
// Supabase's plain object endpoint (/storage/v1/object/public/...) silently
// IGNORES ?width=/&quality= — those params only take effect on the separate
// render/image endpoint (confirmed by curl: identical byte size from
// object/public with vs. without the params, but a real ~80% reduction via
// render/image/public on the same file). This rewrites the path segment
// accordingly. Both `coverUrl` and `mediaUrl` resolve through the same
// storage provider's getPublicUrl() (see backend/src/storage/supabase.ts),
// so this applies equally regardless of which field it's given. URLs that
// don't match the expected Supabase object shape (e.g. the local-storage
// dev fallback, which doesn't support transforms) pass through unchanged.
export function thumbUrl(url: string): string {
  const match = url.match(/^(.*\/storage\/v1)\/object\/public\/(.+)$/)
  if (!match) return url
  const [, base, rest] = match
  return `${base}/render/image/public/${rest}?width=300&quality=75`
}
