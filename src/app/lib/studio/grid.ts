export function gridGeometry(
  w: number,
  h: number,
  p: Record<string, number>,
  system: string,
) {
  if (
    ![w, h, ...Object.values(p)].every(Number.isFinite) ||
    w < 100 ||
    h < 100 ||
    w > 5000 ||
    h > 5000
  )
    throw new Error(
      "Dimensions must be 100–5000px and parameters must be finite.",
    );
  if (
    !Number.isInteger(p.cols) ||
    !Number.isInteger(p.rows) ||
    p.cols < 1 ||
    p.cols > 36 ||
    p.rows < 1 ||
    p.rows > 12 ||
    p.g < 0 ||
    p.bl < 1
  )
    throw new Error("Use positive whole column/row counts and valid spacing.");
  const IW = w - p.ml - p.mr,
    IH = h - p.mt - p.mb,
    rows = system === "column" ? 1 : p.rows;
  const colW = (IW - p.g * (p.cols - 1)) / p.cols,
    rowH = system === "baseline" ? p.bl : (IH - p.g * (rows - 1)) / rows;
  if (
    [p.ml, p.mr, p.mt, p.mb].some((n) => n < 0) ||
    IW <= 0 ||
    IH <= 0 ||
    (["swiss", "column", "baseline", "compound"].includes(system) &&
      colW <= 0) ||
    (system === "swiss" && rowH <= 0) ||
    (system === "compound" && (IW - p.g * (p.rows - 1)) / p.rows <= 0)
  )
    throw new Error(
      "Margins and gutters leave no usable grid fields. Reduce them or increase the canvas.",
    );
  return { IW, IH, colW, rowH };
}
