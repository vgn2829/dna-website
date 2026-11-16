function hasExternalUrl(value: string): boolean {
  // Validate each CSS URL target after trimming and removing matching quotes.
  // Optional-prefix lookaheads can backtrack and reject quoted local fragments.
  let invalid = false;
  const remainder = value.replace(/url\s*\(([^)]*)\)/gi, (_, raw: string) => {
    let target = raw.trim();
    if (
      (target.startsWith('"') && target.endsWith('"')) ||
      (target.startsWith("'") && target.endsWith("'"))
    )
      target = target.slice(1, -1).trim();
    if (!/^#[\w:.-]+$/.test(target)) invalid = true;
    return "";
  });
  return invalid || /url\s*\(/i.test(remainder) || /[\\]|\/\*/.test(value);
}
/** SVGs are displayed ONLY as image resources, never as application DOM. */
export function prepareSvg(text: string): {
  text: string;
  w: number;
  h: number;
} {
  if (text.length > 10 * 1024 * 1024)
    throw new Error("SVG must be under 10 MB.");
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("SVG document declarations are unsupported.");
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const el = doc.documentElement;
  if (
    doc.querySelector("parsererror") ||
    el.localName !== "svg" ||
    el.namespaceURI !== "http://www.w3.org/2000/svg"
  ) {
    throw new Error("Choose a valid SVG document.");
  }
  // No active or foreign content, including resources in CSS or animation.
  // Reject rather than silently changing artwork. Image-resource mode adds a
  // second boundary: scripts/interactivity/external requests are disabled there.
  for (const node of [el, ...Array.from(el.querySelectorAll("*"))]) {
    if (
      [
        "script",
        "foreignobject",
        "style",
        "animate",
        "animatetransform",
        "animatemotion",
        "set",
        "image",
        "feimage",
      ].includes(node.localName.toLowerCase())
    ) {
      throw new Error(
        "SVG must be self-contained, without scripts, animation, stylesheets or embedded images.",
      );
    }
    for (const attr of Array.from(node.attributes)) {
      const name = attr.localName.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "base" ||
        /(?:javascript:|@import|expression\s*\()/i.test(attr.value)
      ) {
        throw new Error("SVG contains active content.");
      }
      if (
        (name === "href" && !/^#[\w:.-]+$/.test(attr.value)) ||
        hasExternalUrl(attr.value)
      ) {
        throw new Error("SVG must not reference external resources.");
      }
    }
  }
  if (Array.from(doc.childNodes).some((n) => n.nodeType === 7))
    throw new Error("SVG stylesheets are unsupported.");
  const numeric = (v: string | null) =>
    v && /^\d+(?:\.\d+)?(?:px)?$/.test(v) ? parseFloat(v) : NaN;
  const vb = (el.getAttribute("viewBox") || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const w =
    numeric(el.getAttribute("width")) || (vb.length === 4 ? vb[2] : 1024);
  const h =
    numeric(el.getAttribute("height")) || (vb.length === 4 ? vb[3] : 1024);
  if (
    ![w, h].every((n) => Number.isFinite(n) && n > 0 && n <= 8192) ||
    w * h > 16_777_216
  ) {
    throw new Error("SVG dimensions exceed the 8192px / 16 megapixel limit.");
  }
  el.setAttribute("width", String(w));
  el.setAttribute("height", String(h));
  return { text: new XMLSerializer().serializeToString(el), w, h };
}
export function svgImageUrl(text: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
}
