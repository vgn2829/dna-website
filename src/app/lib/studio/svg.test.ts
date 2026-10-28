// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { prepareSvg, svgImageUrl } from "./svg";
const wrap = (body: string, attrs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 30" ${attrs}>${body}</svg>`;
describe("untrusted SVG input boundary", () => {
  it.each([
    wrap("", 'onload="window.marker=1"'),
    wrap("<script>window.marker=1</script>"),
    wrap(
      '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">HTML</div></foreignObject>',
    ),
    wrap('<image href="https://example.invalid/pixel"/>'),
    wrap('<use href="https://example.invalid/a.svg#x"/>'),
    wrap('<path style="fill:url(https://example.invalid/a)"/>'),
    wrap('<style>@import "https://example.invalid/style";</style>'),
    '<?xml-stylesheet href="https://example.invalid/style"?>' + wrap(""),
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "https://example.invalid/data">]>' +
      wrap(""),
    "<html>not svg</html>",
    wrap("<unclosed>"),
    wrap("", 'width="99999" height="99999"'),
  ])("rejects active, external or invalid content %#", (input) => {
    expect(() => prepareSvg(input)).toThrow();
    expect((window as unknown as { marker?: number }).marker).toBeUndefined();
  });
  it("preserves self-contained gradients, geometry and viewBox-only dimensions", () => {
    const result = prepareSvg(
      wrap(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><path fill="url(#g)" d="M0 0h20v30z"/>',
      ),
    );
    expect(result).toMatchObject({ w: 20, h: 30 });
    expect(result.text).toContain("url(#g)");
    expect(svgImageUrl(result.text)).toMatch(
      /^data:image\/svg\+xml;charset=utf-8,/,
    );
  });
});

it.each(["url('#g')", "url( #g)", 'url( "#g" )'])(
  "allows quoted and spaced local SVG references %s",
  (value) => {
    expect(() =>
      prepareSvg(wrap(`<path fill='${value.replace(/'/g, "&apos;")}'/>`)),
    ).not.toThrow();
  },
);
it.each([
  "url(https://example.invalid/a)",
  "url('#g') url('https://example.invalid/b')",
  "url( #g",
  "url(/*x*/#g)",
])("rejects malformed or external SVG URL %s", (value) => {
  expect(() =>
    prepareSvg(wrap(`<path fill='${value.replace(/'/g, "&apos;")}'/>`)),
  ).toThrow();
});
