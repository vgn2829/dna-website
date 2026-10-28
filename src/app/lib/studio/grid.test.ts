import { it, expect } from "vitest";
import { gridGeometry } from "./grid";
import { validGridSnapshot } from "../../components/studio/GridCalculator";
const p = {
  cols: 4,
  rows: 5,
  mt: 50,
  mb: 50,
  ml: 40,
  mr: 40,
  g: 12,
  bl: 18,
  angle: 45,
  customW: 800,
  customH: 600,
};
it("rejects impossible field sizes rather than drawing negative columns", () => {
  expect(() =>
    gridGeometry(794, 1123, { ...p, cols: 16, g: 60 }, "swiss"),
  ).toThrow();
  expect(() => gridGeometry(0, 600, p, "swiss")).toThrow();
});
it("reports system-specific row height", () => {
  expect(gridGeometry(794, 1123, p, "column").rowH).toBe(1023);
  expect(gridGeometry(794, 1123, p, "baseline").rowH).toBe(18);
});
it("rejects malformed or obsolete persisted snapshots", () => {
  for (const v of [
    null,
    {},
    { params: null },
    { fmtId: "a4", system: "missing", params: p, landscape: false, ts: 1 },
  ])
    expect(validGridSnapshot(v)).toBe(false);
  expect(
    validGridSnapshot({
      fmtId: "custom",
      system: "swiss",
      params: p,
      landscape: true,
      ts: 1,
    }),
  ).toBe(true);
});
