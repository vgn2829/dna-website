import { gridGeometry } from "../../lib/studio/grid";
import { useState, useEffect, useRef } from "react";
import { T, ss } from "./style";
const FORMATS = [
  {
    id: "a4",
    label: "A4",
    w: 794,
    h: 1123,
    dw: "210mm",
    dh: "297mm",
    desc: "Standard editorial",
  },
  {
    id: "a3",
    label: "A3",
    w: 1123,
    h: 1587,
    dw: "297mm",
    dh: "420mm",
    desc: "Poster / exhibition",
  },
  {
    id: "a5",
    label: "A5",
    w: 559,
    h: 794,
    dw: "148mm",
    dh: "210mm",
    desc: "Flyer / booklet",
  },
  {
    id: "letter",
    label: "US Letter",
    w: 816,
    h: 1056,
    dw: "8.5in",
    dh: "11in",
    desc: "US standard",
  },
  {
    id: "post18",
    label: "Poster 18×24",
    w: 1728,
    h: 2304,
    dw: "18in",
    dh: "24in",
    desc: "US poster standard",
  },
  {
    id: "post24",
    label: "Poster 24×36",
    w: 2304,
    h: 3456,
    dw: "24in",
    dh: "36in",
    desc: "Large format",
  },
  {
    id: "square",
    label: "Square",
    w: 800,
    h: 800,
    dw: "800px",
    dh: "800px",
    desc: "Social / album",
  },
  {
    id: "wide",
    label: "16:9",
    w: 1920,
    h: 1080,
    dw: "1920px",
    dh: "1080px",
    desc: "Screen / slides",
  },
  {
    id: "custom",
    label: "Custom",
    w: 800,
    h: 600,
    dw: "",
    dh: "",
    desc: "Your dimensions",
  },
];

const GRID_SYSTEMS = [
  {
    id: "swiss",
    label: "Swiss Modular",
    icon: "⊞",
    cat: "Editorial",
    desc: "Müller-Brockmann's system: columns × rows = fields. Every margin and gutter derived from the baseline. The DNA of the International Typographic Style.",
  },
  {
    id: "column",
    label: "Column Grid",
    icon: "≡",
    cat: "Editorial",
    desc: "Pure vertical divisions. Newspaper: 6-col. Magazine: 3-4 col. Web: 12-col. The workhorse of all editorial layout.",
  },
  {
    id: "baseline",
    label: "Baseline Grid",
    icon: "⊟",
    cat: "Editorial",
    desc: "Dense horizontal lines set to your body type's leading. Aligns all type across every column. The typographer's essential tool.",
  },
  {
    id: "golden",
    label: "Golden Ratio",
    icon: "φ",
    cat: "Harmonic",
    desc: "φ = 1.618. Recursive golden-section divisions. Each cut divides the longer edge in the ratio 1.618:1; this is a layout guide, not a logarithmic spiral.",
  },
  {
    id: "thirds",
    label: "Rule of Thirds",
    icon: "⊠",
    cat: "Harmonic",
    desc: "Simplified golden ratio: 9-block 3×3 grid. Focal points at the four intersections. Classical composition from photography, poster, and painting.",
  },
  {
    id: "radial",
    label: "Radial / Polar",
    icon: "◎",
    cat: "Poster",
    desc: "Lines radiate from a central point, intersected by concentric rings. Creates a hypnotic bullseye. Perfect for event posters, music gigs, dramatic focal compositions.",
  },
  {
    id: "isometric",
    label: "Isometric",
    icon: "⬡",
    cat: "Poster",
    desc: "Lines at 30° angles instead of 90°. Creates the illusion of 3D depth on a flat surface. Tech, web3, architectural and gaming aesthetics.",
  },
  {
    id: "diagonal",
    label: "Diagonal / Angular",
    icon: "⤡",
    cat: "Poster",
    desc: "Entire grid tilted 45°. Horizontal lines = rest. Diagonal lines = speed, tension, kinetic energy. Streetwear, sports, Russian Constructivism.",
  },
  {
    id: "compound",
    label: "Compound",
    icon: "⊕",
    cat: "Poster",
    desc: "Two conflicting grids overlaid (e.g. 3-col + 4-col). Elements snap to different grids. Creates controlled chaos — complex rhythm that feels organic yet mathematical.",
  },
];

function drawGrid(
  canvas: HTMLCanvasElement | null,
  system: string,
  params: Record<string, number>,
  fmtW: number,
  fmtH: number,
) {
  if (!canvas) return;
  try {
    gridGeometry(fmtW, fmtH, params, system);
  } catch {
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const ctx = canvas.getContext("2d")!;
  const CW = canvas.width,
    CH = canvas.height;
  const sc = Math.min((CW - 40) / fmtW, (CH - 40) / fmtH);
  const PW = Math.round(fmtW * sc),
    PH = Math.round(fmtH * sc);
  const OX = Math.round((CW - PW) / 2),
    OY = Math.round((CH - PH) / 2);

  ctx.clearRect(0, 0, CW, CH);
  ctx.fillStyle = "#0d0d0f";
  ctx.fillRect(0, 0, CW, CH);
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 20;
  ctx.fillStyle = "#1a1a1e";
  ctx.fillRect(OX, OY, PW, PH);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#323238";
  ctx.lineWidth = 1;
  ctx.strokeRect(OX + 0.5, OY + 0.5, PW - 1, PH - 1);

  const mg = {
    t: params.mt * sc,
    b: params.mb * sc,
    l: params.ml * sc,
    r: params.mr * sc,
  };
  const IW = PW - mg.l - mg.r,
    IH = PH - mg.t - mg.b;
  const IX = OX + mg.l,
    IY = OY + mg.t;
  const g = params.g * sc,
    bl = params.bl * sc;
  const cols = Math.max(params.cols, 1),
    rows = Math.max(params.rows, 1);
  const cw = (IW - g * (cols - 1)) / cols,
    rh = (IH - g * (rows - 1)) / rows;

  ctx.fillStyle = "rgba(255,160,50,0.04)";
  ctx.fillRect(OX, OY, mg.l, PH);
  ctx.fillRect(OX + PW - mg.r, OY, mg.r, PH);
  ctx.fillRect(IX, OY, IW, mg.t);
  ctx.fillRect(IX, OY + PH - mg.b, IW, mg.b);
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = "rgba(255,160,50,0.4)";
  ctx.lineWidth = 0.75;
  ctx.strokeRect(IX + 0.5, IY + 0.5, IW - 1, IH - 1);
  ctx.setLineDash([]);

  function lbl(txt: string, x: number, y: number, col = "#aaa", sz = 9) {
    ctx.save();
    ctx.font = `${sz}px Inter,sans-serif`;
    ctx.fillStyle = col;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(txt, x, y);
    ctx.restore();
  }
  function arrH(
    x1: number,
    y: number,
    x2: number,
    val: string,
    col = "rgba(255,160,50,0.7)",
  ) {
    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y - 4);
    ctx.lineTo(x1, y + 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y - 4);
    ctx.lineTo(x2, y + 4);
    ctx.stroke();
    lbl(val, (x1 + x2) / 2, y - 9, col, 8);
    ctx.restore();
  }

  if (system === "swiss" || system === "column") {
    const numC = cols,
      numR = system === "swiss" ? rows : 1;
    const _cw = (IW - g * (numC - 1)) / numC;
    const _rh = numR > 1 ? (IH - g * (numR - 1)) / numR : IH;
    for (let r = 0; r < numR; r++) {
      for (let c = 0; c < numC; c++) {
        const x = IX + c * (_cw + g),
          y = IY + r * (_rh + g);
        ctx.fillStyle =
          (r + c) % 2 === 0 ? "rgba(99,102,241,0.18)" : "rgba(99,102,241,0.10)";
        ctx.fillRect(x, y, _cw, _rh);
        ctx.strokeStyle = "rgba(99,102,241,0.45)";
        ctx.lineWidth = 0.6;
        ctx.strokeRect(x + 0.5, y + 0.5, _cw - 0.5, _rh - 0.5);
        if (numC <= 8 && numR <= 6)
          lbl(
            `${c + 1}${system === "swiss" ? `,${r + 1}` : ""}`,
            x + _cw / 2,
            y + _rh / 2,
            "rgba(165,180,252,0.6)",
          );
      }
    }
    if (system === "swiss" && numC >= 2 && numR >= 2) {
      ctx.fillStyle = "rgba(168,85,247,0.25)";
      ctx.fillRect(IX, IY, _cw * 2 + g, _rh * 2 + g);
      ctx.strokeStyle = "rgba(168,85,247,0.85)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(IX + 0.5, IY + 0.5, _cw * 2 + g - 1, _rh * 2 + g - 1);
      lbl(
        "spatial zone",
        IX + (_cw * 2 + g) / 2,
        IY + (_rh * 2 + g) / 2,
        "rgba(216,180,254,0.9)",
      );
    }
    for (let c = 0; c < numC - 1; c++) {
      ctx.fillStyle = "rgba(250,204,21,0.06)";
      ctx.fillRect(IX + c * (_cw + g) + _cw, IY, g, IH);
    }
    arrH(IX, IY + IH + sc * 3, IX + _cw, `${(_cw / sc).toFixed(0)}px col`);
    if (g > 0)
      arrH(
        IX + _cw,
        IY + IH + sc * 3,
        IX + _cw + g,
        `${(g / sc).toFixed(0)}px`,
        "rgba(250,204,21,0.7)",
      );
  } else if (system === "baseline") {
    for (let c = 0; c < cols; c++) {
      const x = IX + c * (cw + g);
      ctx.fillStyle = "rgba(99,102,241,0.07)";
      ctx.fillRect(x, IY, cw, IH);
    }
    if (bl > 1) {
      let li = 0;
      for (let y = IY; y <= IY + IH; y += bl) {
        ctx.strokeStyle =
          li % 4 === 0 ? "rgba(34,197,94,0.8)" : "rgba(34,197,94,0.2)";
        ctx.lineWidth = li % 4 === 0 ? 0.9 : 0.4;
        ctx.beginPath();
        ctx.moveTo(IX, y);
        ctx.lineTo(IX + IW, y);
        ctx.stroke();
        li++;
      }
      ctx.fillStyle = "rgba(255,255,255,0.11)";
      for (let y = IY + bl; y < IY + IH - bl; y += bl) {
        ctx.fillRect(IX + 8, y - bl + 2, 0.7 * IW, bl - 3);
      }
      lbl(
        `${params.bl}px baseline`,
        IX + IW / 2,
        IY + bl / 2,
        "rgba(34,197,94,0.8)",
      );
    }
    lbl(
      `${params.bl}px baseline · ${cols} col${cols > 1 ? "s" : ""}`,
      OX + PW / 2,
      OY + PH - 8,
      "rgba(34,197,94,0.6)",
    );
  } else if (system === "golden") {
    const phi = 1.618;
    const squares: any[] = [];
    let x = IX,
      y = IY,
      w = IW,
      h = IH;
    for (let i = 0; i < 7; i++) {
      if (w > h) {
        const sw = w / phi;
        squares.push({ x, y, w: sw, h, idx: i });
        x += sw;
        w -= sw;
      } else {
        const sh = h / phi;
        squares.push({ x, y, w, h: sh, idx: i });
        y += sh;
        h -= sh;
      }
      if (w < 2 || h < 2) break;
    }
    squares.forEach((sq: any, i: number) => {
      const alpha = [0.22, 0.18, 0.15, 0.12, 0.1, 0.08, 0.06][i] || 0.05;
      ctx.fillStyle = `rgba(99,102,241,${alpha})`;
      ctx.fillRect(sq.x, sq.y, sq.w, sq.h);
      ctx.strokeStyle = `rgba(99,102,241,${alpha * 3})`;
      ctx.lineWidth = 0.75;
      ctx.strokeRect(sq.x + 0.5, sq.y + 0.5, sq.w - 0.5, sq.h - 0.5);
    });
    ctx.font = "bold 14px Georgia,serif";
    ctx.fillStyle = "rgba(250,204,21,0.6)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("φ = 1.618", OX + PW / 2, OY + PH - 9);
    lbl(
      `${(IW / phi / sc).toFixed(0)}px main · ${((IW - IW / phi) / sc).toFixed(0)}px side`,
      OX + PW / 2,
      OY + PH + 13,
      "rgba(165,180,252,0.6)",
    );
  } else if (system === "thirds") {
    const tw = IW / 3,
      th = IH / 3;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle =
          (r + c) % 2 === 0 ? "rgba(99,102,241,0.12)" : "rgba(99,102,241,0.06)";
        ctx.fillRect(IX + c * tw, IY + r * th, tw, th);
      }
    ctx.strokeStyle = "rgba(250,204,21,0.6)";
    ctx.lineWidth = 0.9;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(IX + i * tw, IY);
      ctx.lineTo(IX + i * tw, IY + IH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(IX, IY + i * th);
      ctx.lineTo(IX + IW, IY + i * th);
      ctx.stroke();
    }
    [
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
    ].forEach(([c, r]) => {
      const px = IX + c * tw,
        py = IY + r * th;
      ctx.fillStyle = "rgba(250,204,21,0.95)";
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(250,204,21,0.4)";
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.stroke();
    });
    arrH(IX, IY + IH + sc * 3, IX + tw, `${(tw / sc).toFixed(0)}px`);
  } else if (system === "radial") {
    const cx = OX + PW / 2,
      cy = OY + PH / 2;
    const maxR = Math.max(PW, PH) * 0.6;
    const rings = params.rows || 5,
      spokes = params.cols || 12;
    for (let r = 1; r <= rings; r++) {
      const rad = maxR * (r / rings);
      ctx.strokeStyle = `rgba(99,102,241,${0.15 + r * 0.06})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(99,102,241,${0.03 + r * 0.01})`;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let s = 0; s < spokes; s++) {
      const angle = (s / spokes) * Math.PI * 2 - Math.PI / 2;
      ctx.strokeStyle = `rgba(250,204,21,${s === 0 ? 0.7 : 0.25})`;
      ctx.lineWidth = s === 0 ? 1.2 : 0.6;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
      ctx.stroke();
      if (spokes <= 16) {
        const lx = cx + Math.cos(angle) * (maxR + 10),
          ly = cy + Math.sin(angle) * (maxR + 10);
        lbl(
          `${Math.round(s * (360 / spokes))}°`,
          lx,
          ly,
          "rgba(250,204,21,0.5)",
          8,
        );
      }
    }
    ctx.fillStyle = "rgba(168,85,247,0.6)";
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(168,85,247,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.stroke();
    lbl("focal center", cx, cy - 28, "rgba(216,180,254,0.9)");
    lbl(
      `${spokes} spokes · ${rings} rings`,
      OX + PW / 2,
      OY + PH - 8,
      "rgba(165,180,252,0.6)",
    );
  } else if (system === "isometric") {
    const angleRad = (30 * Math.PI) / 180;
    const spacing = params.g * sc * 2 || 32;
    ctx.strokeStyle = "rgba(99,102,241,0.25)";
    ctx.lineWidth = 0.6;
    for (let x = OX - PH; x < OX + PW + PH; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, OY);
      ctx.lineTo(x + PH / Math.tan(Math.PI / 2 - angleRad), OY + PH);
      ctx.stroke();
    }
    for (let x = OX - PH; x < OX + PW + PH; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, OY);
      ctx.lineTo(x - PH / Math.tan(Math.PI / 2 - angleRad), OY + PH);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(99,102,241,0.12)";
    for (let y = OY; y < OY + PH; y += spacing * Math.sin(angleRad) * 2) {
      ctx.beginPath();
      ctx.moveTo(OX, y);
      ctx.lineTo(OX + PW, y);
      ctx.stroke();
    }
    const cx = OX + PW / 2,
      cy = OY + PH / 2,
      cs = Math.min(PW, PH) * 0.18;
    const pts: any = {
      t: [cx, cy - cs],
      r: [cx + cs * 0.866, cy - cs * 0.5],
      b: [cx, cy],
      l: [cx - cs * 0.866, cy - cs * 0.5],
    };
    ctx.fillStyle = "rgba(168,85,247,0.3)";
    ctx.beginPath();
    ctx.moveTo(pts.t[0], pts.t[1]);
    ctx.lineTo(pts.r[0], pts.r[1]);
    ctx.lineTo(pts.b[0], pts.b[1]);
    ctx.lineTo(pts.l[0], pts.l[1]);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(99,102,241,0.25)";
    ctx.beginPath();
    ctx.moveTo(pts.b[0], pts.b[1]);
    ctx.lineTo(pts.r[0], pts.r[1]);
    ctx.lineTo(pts.r[0], pts.r[1] + cs);
    ctx.lineTo(pts.b[0], pts.b[1] + cs);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(99,102,241,0.15)";
    ctx.beginPath();
    ctx.moveTo(pts.b[0], pts.b[1]);
    ctx.lineTo(pts.l[0], pts.l[1]);
    ctx.lineTo(pts.l[0], pts.l[1] + cs);
    ctx.lineTo(pts.b[0], pts.b[1] + cs);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(168,85,247,0.8)";
    ctx.lineWidth = 1.2;
    [
      [pts.t, pts.r],
      [pts.r, pts.b],
      [pts.b, pts.l],
      [pts.l, pts.t],
    ].forEach(([a, b2]) => {
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b2[0], b2[1]);
      ctx.stroke();
    });
    lbl("isometric cube", cx, cy + cs + 14, "rgba(216,180,254,0.8)");
    lbl(
      "30° grid — flat elements with 3D depth",
      OX + PW / 2,
      OY + PH - 8,
      "rgba(165,180,252,0.6)",
    );
  } else if (system === "diagonal") {
    const angle = params.angle || 45;
    const rad = (angle * Math.PI) / 180;
    const spacing = params.g * sc * 2 || 28;
    ctx.strokeStyle = "rgba(99,102,241,0.3)";
    ctx.lineWidth = 0.7;
    const diagLen = Math.sqrt(PW * PW + PH * PH) * 1.5;
    for (let d = -diagLen; d < diagLen * 2; d += spacing) {
      ctx.beginPath();
      ctx.moveTo(
        OX + PW / 2 + Math.cos(rad) * d - (Math.sin(rad) * diagLen) / 2,
        OY + PH / 2 + Math.sin(rad) * d + (Math.cos(rad) * diagLen) / 2,
      );
      ctx.lineTo(
        OX + PW / 2 + Math.cos(rad) * d + (Math.sin(rad) * diagLen) / 2,
        OY + PH / 2 + Math.sin(rad) * d - (Math.cos(rad) * diagLen) / 2,
      );
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(250,204,21,0.25)";
    ctx.lineWidth = 0.4;
    const bRad = ((angle + 90) * Math.PI) / 180;
    for (let d = -diagLen; d < diagLen * 2; d += spacing * 0.4) {
      ctx.beginPath();
      ctx.moveTo(
        OX + PW / 2 + Math.cos(bRad) * d - (Math.sin(bRad) * diagLen) / 2,
        OY + PH / 2 + Math.sin(bRad) * d + (Math.cos(bRad) * diagLen) / 2,
      );
      ctx.lineTo(
        OX + PW / 2 + Math.cos(bRad) * d + (Math.sin(bRad) * diagLen) / 2,
        OY + PH / 2 + Math.sin(bRad) * d - (Math.cos(bRad) * diagLen) / 2,
      );
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(13,13,15,0.75)";
    ctx.fillRect(0, 0, OX, CH);
    ctx.fillRect(OX + PW, 0, CW - OX - PW, CH);
    ctx.fillRect(OX, 0, PW, OY);
    ctx.fillRect(OX, OY + PH, PW, CH - OY - PH);
    lbl(
      `${angle}° diagonal grid — kinetic energy`,
      OX + PW / 2,
      OY + PH - 8,
      "rgba(250,204,21,0.6)",
    );
  } else if (system === "compound") {
    const cols1 = params.cols || 3,
      cols2 = params.rows || 4;
    const cw1 = (IW - g * (cols1 - 1)) / cols1;
    const cw2 = (IW - g * (cols2 - 1)) / cols2;
    for (let c = 0; c < cols1; c++) {
      ctx.fillStyle = "rgba(99,102,241,0.12)";
      ctx.fillRect(IX + c * (cw1 + g), IY, cw1, IH);
      ctx.strokeStyle = "rgba(99,102,241,0.5)";
      ctx.lineWidth = 0.7;
      ctx.strokeRect(IX + c * (cw1 + g) + 0.5, IY + 0.5, cw1 - 0.5, IH - 0.5);
    }
    for (let c = 0; c < cols2; c++) {
      ctx.strokeStyle = "rgba(244,63,94,0.5)";
      ctx.lineWidth = 0.7;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(IX + c * (cw2 + g) + 0.5, IY + 0.5, cw2 - 0.5, IH - 0.5);
      ctx.setLineDash([]);
    }
    [
      { c: "rgba(99,102,241,0.8)", l: `${cols1}-col grid` },
      { c: "rgba(244,63,94,0.8)", l: `${cols2}-col grid (dashed)` },
    ].forEach(({ c, l }: any, i: number) => {
      ctx.fillStyle = c;
      ctx.fillRect(IX, OY + PH - 28 + i * 12, 20, 8);
      lbl(l, IX + 60, OY + PH - 24 + i * 12, c, 8.5);
    });
    lbl(
      "compound grid — controlled chaos",
      OX + PW / 2,
      OY + PH - 8,
      "rgba(255,255,255,0.3)",
    );
    arrH(
      IX,
      IY + IH + sc * 3,
      IX + cw1,
      `${(cw1 / sc).toFixed(0)}px`,
      "rgba(99,102,241,0.7)",
    );
    arrH(
      IX,
      IY + IH + sc * 6,
      IX + cw2,
      `${(cw2 / sc).toFixed(0)}px`,
      "rgba(244,63,94,0.7)",
    );
  }

  ctx.font = "10px Inter,sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  const fmt = FORMATS.find((f) => f.w === fmtW && f.h === fmtH);
  ctx.fillText(
    `${fmt?.dw || fmtW + "px"} × ${fmt?.dh || fmtH + "px"}`,
    OX + PW - 6,
    OY + PH - 5,
  );
}

// ── Grid Calculator: recent generations (localStorage) ────────────────────────
type GridSnapshot = {
  fmtId: string;
  system: string;
  landscape: boolean;
  params: Record<string, number>;
  ts: number;
};
const GRID_RECENTS_KEY = "dna_grid_recents";
const GRID_RECENTS_MAX = 10;
export function validGridSnapshot(value: unknown): value is GridSnapshot {
  if (!value || typeof value !== "object") return false;
  const s = value as GridSnapshot;
  if (
    !FORMATS.some((f) => f.id === s.fmtId) ||
    !GRID_SYSTEMS.some((g) => g.id === s.system) ||
    typeof s.landscape !== "boolean" ||
    !Number.isFinite(s.ts) ||
    !s.params ||
    typeof s.params !== "object"
  )
    return false;
  if (
    ![
      "cols",
      "rows",
      "mt",
      "mb",
      "ml",
      "mr",
      "g",
      "bl",
      "angle",
      "customW",
      "customH",
    ].every((k) => Number.isFinite(s.params[k]))
  )
    return false;
  const fmt = FORMATS.find((f) => f.id === s.fmtId)!;
  const w = s.fmtId === "custom" ? s.params.customW : fmt.w,
    h = s.fmtId === "custom" ? s.params.customH : fmt.h;
  try {
    gridGeometry(s.landscape ? h : w, s.landscape ? w : h, s.params, s.system);
    return true;
  } catch {
    return false;
  }
}
function loadGridRecents(): GridSnapshot[] {
  try {
    const raw = localStorage.getItem(GRID_RECENTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.filter(validGridSnapshot).slice(0, GRID_RECENTS_MAX)
      : [];
  } catch {
    return [];
  }
}
function gridSnapKey(s: {
  fmtId: string;
  system: string;
  landscape: boolean;
  params: Record<string, number>;
}): string {
  return JSON.stringify([s.fmtId, s.system, s.landscape, s.params]);
}
function gridSnapLabel(s: GridSnapshot): string {
  const sys = GRID_SYSTEMS.find((g) => g.id === s.system)?.label ?? s.system;
  const fmt = FORMATS.find((f) => f.id === s.fmtId)?.label ?? s.fmtId;
  return `${sys} · ${fmt}${s.landscape ? " ↔" : ""}`;
}
function gridRelTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function GridCalculator() {
  const [fmtId, setFmtId] = useState("a4");
  const [system, setSystem] = useState("swiss");
  const [landscape, setLandscape] = useState(false);
  const [params, setParams] = useState<Record<string, number>>({
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
  });
  const [recents, setRecents] = useState<GridSnapshot[]>(loadGridRecents);
  const changed = useRef(false);
  const pending = useRef<GridSnapshot | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fmt = FORMATS.find((f) => f.id === fmtId) || FORMATS[0];
  const baseW = fmtId === "custom" ? params.customW : fmt.w,
    baseH = fmtId === "custom" ? params.customH : fmt.h;
  const fmtW = landscape ? baseH : baseW,
    fmtH = landscape ? baseW : baseH;
  function setP(k: string, v: number) {
    changed.current = true;
    setParams((p) => ({ ...p, [k]: v }));
  }
  function setFormat(id: string) {
    changed.current = true;
    setFmtId(id);
    const presets: Record<string, any> = {
      a4: { cols: 4, rows: 5, mt: 50, mb: 50, ml: 40, mr: 40, g: 12, bl: 18 },
      a3: { cols: 4, rows: 6, mt: 60, mb: 60, ml: 50, mr: 50, g: 14, bl: 20 },
      a5: { cols: 3, rows: 4, mt: 35, mb: 35, ml: 28, mr: 28, g: 10, bl: 16 },
      letter: {
        cols: 4,
        rows: 5,
        mt: 48,
        mb: 48,
        ml: 36,
        mr: 36,
        g: 12,
        bl: 16,
      },
      post18: {
        cols: 5,
        rows: 6,
        mt: 80,
        mb: 80,
        ml: 60,
        mr: 60,
        g: 18,
        bl: 22,
      },
      post24: {
        cols: 6,
        rows: 8,
        mt: 100,
        mb: 100,
        ml: 80,
        mr: 80,
        g: 20,
        bl: 24,
      },
      square: {
        cols: 3,
        rows: 3,
        mt: 40,
        mb: 40,
        ml: 40,
        mr: 40,
        g: 16,
        bl: 20,
      },
      wide: { cols: 6, rows: 3, mt: 60, mb: 60, ml: 80, mr: 80, g: 20, bl: 20 },
    };
    if (presets[id]) setParams((p) => ({ ...p, ...presets[id] }));
  }

  useEffect(() => {
    drawGrid(canvasRef.current, system, params, fmtW, fmtH);
  }, [system, params, fmtId, landscape]);

  let geometry: ReturnType<typeof gridGeometry> | null = null,
    geometryError = "";
  try {
    geometry = gridGeometry(fmtW, fmtH, params, system);
  } catch (err) {
    geometryError = (err as Error).message;
  }
  const write = (snap: GridSnapshot) => {
    let previous: GridSnapshot[] = [];
    try {
      previous = loadGridRecents();
    } catch {}
    const next = [
      snap,
      ...previous.filter((r) => gridSnapKey(r) !== gridSnapKey(snap)),
    ].slice(0, GRID_RECENTS_MAX);
    try {
      localStorage.setItem(GRID_RECENTS_KEY, JSON.stringify(next));
    } catch {}
    return next;
  };
  useEffect(() => {
    if (!changed.current || geometryError) return;
    const snap = { fmtId, system, landscape, params, ts: Date.now() };
    pending.current = snap;
    const timer = setTimeout(() => {
      if (pending.current !== snap) return;
      setRecents(write(snap));
      pending.current = null;
    }, 700);
    return () => clearTimeout(timer);
  }, [fmtId, system, landscape, params, geometryError]);
  useEffect(
    () => () => {
      if (pending.current) write(pending.current);
    },
    [],
  );
  const restoreGrid = (snap: GridSnapshot) => {
    if (!validGridSnapshot(snap)) return;
    changed.current = true;
    setFmtId(snap.fmtId);
    setSystem(snap.system);
    setLandscape(snap.landscape);
    setParams(snap.params);
  };

  const clearRecents = () => {
    pending.current = null;
    changed.current = false;
    setRecents([]);
    try {
      localStorage.removeItem(GRID_RECENTS_KEY);
    } catch {
      /* ignore */
    }
  };

  const { IW = 0, IH = 0, colW = 0, rowH = 0 } = geometry || {};
  const sys = GRID_SYSTEMS.find((g) => g.id === system)!;

  const controlDefs: Record<
    string,
    { k: string; l: string; mn: number; mx: number }[]
  > = {
    swiss: [
      { k: "cols", l: "Columns", mn: 1, mx: 16 },
      { k: "rows", l: "Rows", mn: 1, mx: 12 },
      { k: "g", l: "Gutter (px)", mn: 0, mx: 60 },
      { k: "ml", l: "Margin left", mn: 0, mx: 200 },
      { k: "mr", l: "Margin right", mn: 0, mx: 200 },
      { k: "mt", l: "Margin top", mn: 0, mx: 200 },
      { k: "mb", l: "Margin bottom", mn: 0, mx: 200 },
    ],
    column: [
      { k: "cols", l: "Columns", mn: 1, mx: 16 },
      { k: "g", l: "Gutter (px)", mn: 0, mx: 80 },
      { k: "ml", l: "Margin left", mn: 0, mx: 200 },
      { k: "mr", l: "Margin right", mn: 0, mx: 200 },
      { k: "mt", l: "Margin top", mn: 0, mx: 200 },
      { k: "mb", l: "Margin bottom", mn: 0, mx: 200 },
    ],
    baseline: [
      { k: "bl", l: "Baseline (px)", mn: 6, mx: 60 },
      { k: "cols", l: "Columns", mn: 1, mx: 8 },
      { k: "g", l: "Col gutter", mn: 0, mx: 60 },
      { k: "ml", l: "Margin left", mn: 0, mx: 160 },
      { k: "mr", l: "Margin right", mn: 0, mx: 160 },
      { k: "mt", l: "Margin top", mn: 0, mx: 160 },
      { k: "mb", l: "Margin bottom", mn: 0, mx: 160 },
    ],
    golden: [
      { k: "ml", l: "Margin left", mn: 0, mx: 200 },
      { k: "mr", l: "Margin right", mn: 0, mx: 200 },
      { k: "mt", l: "Margin top", mn: 0, mx: 200 },
      { k: "mb", l: "Margin bottom", mn: 0, mx: 200 },
    ],
    thirds: [
      { k: "ml", l: "Margin left", mn: 0, mx: 160 },
      { k: "mr", l: "Margin right", mn: 0, mx: 160 },
      { k: "mt", l: "Margin top", mn: 0, mx: 160 },
      { k: "mb", l: "Margin bottom", mn: 0, mx: 160 },
    ],
    radial: [
      { k: "cols", l: "Spokes", mn: 4, mx: 36 },
      { k: "rows", l: "Rings", mn: 2, mx: 10 },
    ],
    isometric: [{ k: "g", l: "Spacing", mn: 8, mx: 60 }],
    diagonal: [
      { k: "angle", l: "Angle (°)", mn: 15, mx: 75 },
      { k: "g", l: "Spacing", mn: 6, mx: 50 },
    ],
    compound: [
      { k: "cols", l: "Grid A cols", mn: 2, mx: 8 },
      { k: "rows", l: "Grid B cols", mn: 2, mx: 8 },
      { k: "g", l: "Gutter", mn: 0, mx: 40 },
    ],
  };

  const cats = ["Editorial", "Harmonic", "Poster"];

  return (
    <div className="studio-tool">
      {geometryError && (
        <p role="alert" className="studio-status is-error">
          {geometryError}
        </p>
      )}
      <div>
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 10,
            fontWeight: 600,
            color: "var(--color-ink-muted)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 10,
            marginTop: 32,
          }}
        >
          Format
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "nowrap",
            overflowX: "auto",
            scrollbarWidth: "none",
          }}
        >
          {FORMATS.map((f) => (
            <button
              key={f.id}
              aria-pressed={fmtId === f.id}
              onClick={() => setFormat(f.id)}
              style={{
                padding: "6px 14px",
                borderRadius: "var(--radius-pill)",
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--font-body)",
                fontSize: 12,
                fontWeight: fmtId === f.id ? 500 : 400,
                background:
                  fmtId === f.id
                    ? "var(--color-inverse-canvas)"
                    : "var(--color-surface-1)",
                color:
                  fmtId === f.id
                    ? "var(--color-canvas)"
                    : "var(--color-ink-muted)",
                whiteSpace: "nowrap",
              }}
            >
              {f.label}
            </button>
          ))}
          <button
            aria-label={`Swap orientation (currently ${fmtW > fmtH ? "landscape" : "portrait"})`}
            aria-pressed={fmtW > fmtH}
            onClick={() => {
              changed.current = true;
              setLandscape((l) => !l);
            }}
            style={{
              background: "var(--color-surface-1)",
              color: "var(--color-ink)",
              borderRadius: "var(--radius-pill)",
              padding: "10px 18px",
              fontSize: 13,
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--font-body)",
              whiteSpace: "nowrap",
            }}
          >
            {fmtW > fmtH ? "⬛" : "⬜"} {fmtW > fmtH ? "Land" : "Port"}
          </button>
        </div>
        {fmtId === "custom" && (
          <div
            style={{
              background: "var(--color-surface-1)",
              borderRadius: "var(--radius-xl)",
              border: `1px solid ${T.hairlineSoft}`,
              padding: "24px",
              display: "flex",
              gap: 12,
              marginTop: 10,
              flexWrap: "wrap",
            }}
          >
            {[
              ["customW", "Width (px)"],
              ["customH", "Height (px)"],
            ].map(([k, l]) => (
              <div key={k} style={{ width: "min(130px,100%)" }}>
                <label htmlFor={"grid-" + k} style={ss.label}>
                  {l}
                </label>
                <input
                  id={"grid-" + k}
                  type="number"
                  value={params[k]}
                  min={100}
                  max={5000}
                  onChange={(e: any) => setP(k, +e.target.value)}
                  style={{ ...ss.input, fontFamily: "var(--font-mono)" }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {cats.map((cat) => {
        const sys2 = GRID_SYSTEMS.filter((g) => g.cat === cat);
        return (
          <div key={cat}>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 10,
                fontWeight: 600,
                color: "var(--color-ink-muted)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 10,
                marginTop: 32,
              }}
            >
              {cat} Grids
            </div>
            <div
              style={{
                display: "flex",
                gap: 6,
                flexWrap: "nowrap",
                overflowX: "auto",
                scrollbarWidth: "none",
              }}
            >
              {sys2.map((g) => (
                <button
                  key={g.id}
                  aria-pressed={system === g.id}
                  onClick={() => {
                    changed.current = true;
                    setSystem(g.id);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 14px",
                    borderRadius: "var(--radius-pill)",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "var(--font-body)",
                    fontSize: 12,
                    fontWeight: system === g.id ? 500 : 400,
                    background:
                      system === g.id
                        ? "var(--color-inverse-canvas)"
                        : "var(--color-surface-1)",
                    color:
                      system === g.id
                        ? "var(--color-canvas)"
                        : "var(--color-ink-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ fontSize: 14 }}>{g.icon}</span>
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      <div
        style={{
          background: "var(--color-surface-1)",
          borderRadius: "var(--radius-xl)",
          padding: 24,
          border: `1px solid ${T.hairlineSoft}`,
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        <span style={{ fontSize: 22, marginRight: 12, flexShrink: 0 }}>
          {sys.icon}
        </span>
        <div>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 13,
              fontWeight: 600,
              color: T.ink,
              marginBottom: 3,
            }}
          >
            {sys.label}
          </div>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 12,
              color: T.inkMuted,
              lineHeight: 1.6,
            }}
          >
            {sys.desc}
          </div>
        </div>
      </div>

      <div
        style={{
          background: "var(--color-canvas)",
          borderRadius: "var(--radius-xl)",
          overflow: "hidden",
          border: `1px solid ${T.hairlineSoft}`,
          padding: 12,
        }}
      >
        <canvas
          ref={canvasRef}
          width={680}
          height={440}
          style={{
            width: "100%",
            height: "auto",
            display: "block",
            borderRadius: 10,
          }}
        />
      </div>

      {recents.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 10,
              fontWeight: 600,
              color: "var(--color-ink-muted)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginRight: 2,
            }}
          >
            Recent
          </span>
          {recents.map((r, i) => (
            <button
              key={`${r.ts}-${i}`}
              onClick={() => restoreGrid(r)}
              title={`${gridSnapLabel(r)} · cols ${r.params.cols}, rows ${r.params.rows} · ${gridRelTime(r.ts)}`}
              style={{
                padding: "5px 12px",
                borderRadius: "var(--radius-pill)",
                border: "1px solid var(--color-hairline)",
                background: "var(--color-surface-1)",
                color: "var(--color-ink-muted)",
                fontSize: 12,
                fontFamily: "var(--font-body)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {gridSnapLabel(r)}
            </button>
          ))}
          <button
            onClick={clearRecents}
            style={{ ...ss.btnSec, padding: "5px 12px", fontSize: 12 }}
          >
            Clear
          </button>
        </div>
      )}

      {geometry && ["swiss", "column", "baseline"].includes(system) && (
        <div
          className="studio-grid-metrics"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4,minmax(0,1fr))",
            gap: 8,
          }}
        >
          {[
            { l: "Column width", v: `${colW.toFixed(1)}px` },
            { l: "Row height", v: `${rowH.toFixed(1)}px` },
            { l: "Inner area", v: `${IW}×${IH}px` },
            { l: "Aspect ratio", v: `${(IW / IH).toFixed(3)}:1` },
          ].map((s: any) => (
            <div
              key={s.l}
              style={{
                background: "var(--color-surface-1)",
                borderRadius: "var(--radius-lg)",
                padding: "11px 13px",
                border: `1px solid ${T.hairlineSoft}`,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 9,
                  color: "var(--color-ink-muted)",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  marginBottom: 3,
                }}
              >
                {s.l}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--color-ink)",
                }}
              >
                {s.v}
              </div>
            </div>
          ))}
        </div>
      )}

      {(controlDefs[system] || []).length > 0 && (
        <div
          style={{
            background: "var(--color-surface-1)",
            borderRadius: "var(--radius-xl)",
            padding: 24,
            border: `1px solid ${T.hairlineSoft}`,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 10,
              fontWeight: 600,
              color: "var(--color-ink-muted)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Parameters
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))",
              gap: 16,
            }}
          >
            {(controlDefs[system] || []).map((c: any) => (
              <div key={c.k}>
                <label htmlFor={"grid-" + c.k} style={ss.label}>
                  {c.l} —{" "}
                  <span
                    style={{
                      color: T.accentBlue,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {params[c.k]}
                  </span>
                </label>
                <input
                  id={"grid-" + c.k}
                  type="range"
                  min={c.mn}
                  max={c.mx}
                  step={1}
                  value={params[c.k]}
                  onChange={(e: any) => setP(c.k, +e.target.value)}
                  style={{ width: "100%", accentColor: T.accentBlue }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
