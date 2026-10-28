# Palette Generator and Design Studio: audit and proposed redesign

Date: 28 October 2026. Baseline: `79cf2ca` (freshly fetched `origin/main`).
Branch: `feat/palette-design-studio-audit-20261028`.
Worktree: `/private/tmp/dna-studio-audit-20261028`.

**Status: audit recorded; implementation awaits approval under Phase 3 of the supplied brief.**
**Verdict: FAIL for professional release readiness.** This describes the existing baseline, not a regression introduced by this audit. No application source, dependencies, lockfile, deployment configuration, database, or production environment was changed.

## Executive summary

The suite has eight registered tools and useful functionality worth preserving: 18 semantic palette tokens, five visual mood profiles, font exploration with history, a contrast checker, image/PDF conversion, nine grid systems, halftone rendering, two SVG trace engines plus rasterization, and two background-removal models with manual refinement.

The largest problems are correctness and ownership of state and asynchronous work. The live palette engine ignores the selected harmony, emits invalid colours from incomplete seeds, and generates a primary foreground that fails its own contrast test. APCA and colour-distance results are not what their names imply. The UI can display a green score of 86 while reporting a primary-button contrast of 1.79:1. The SVG rasterizer injects uploaded markup into the application DOM. Image/PDF, SVG, and segmentation jobs can finish after reset or input replacement, and several resources have no cleanup owner.

The baseline frontend suite passes 234 tests but does not execute the standalone palette tests. Those reproduce 20 failures out of 130 checks after a local dependency-resolution workaround. Typecheck fails with 16 existing errors, nine in the audited tool paths. The production build and route-collision guard pass. These green signals do not establish correct tool workflows.

Recommendation: fix the SVG trust boundary and colour contracts first; introduce explicit state transitions and job ownership next; then apply the shared tool layout and responsive interaction system. Keep all eight tools and established DNA tokens. Avoid a wholesale page rewrite or dependency upgrade.

## Safety, scope, and evidence

Before creating the worktree, inspected status, local branches, worktrees, stash list, local `main`, remotes, and fetched `origin/main`. Original checkout remains on `fix/assets-deep-link` at `f3ff51c`; its three tracked modifications, untracked files, existing worktrees, and stash were left in place. Local `main` was stale at `6a0d724`; it was not moved. Audit branch starts at fetched `79cf2ca`. Nothing was committed, pushed, merged, or deployed.

Read the supplied instructions and root AGENTS.md from the original checkout; there are no tracked nested AGENTS.md files in this baseline. The user’s new brief supersedes FIX_TASKS.md’s historical exclusion of PaletteStudio internals for the proposed future implementation. No source modifications are authorized by that supersession before the audit approval gate.

Reviewed the primary files in full, both worker hooks, worker protocols, SVG presets and postprocessing, segmentation models/cache/preprocessing/compositing/refinement/upload, halftone algorithm, router and layout callers, theme primitives, manifests, frontend lockfile importer and relevant dependency entries, CI, standalone palette tests, frontend source guards, FIX_TASKS.md, README, and relevant DNA_CLUB_DOCS.md sections. The unused HSL engine is distinguished from the OKLCH engine actually called by the UI. No existing graphify graph was present; no knowledge-graph build was needed for this scoped source audit.

Runtime surfaces: React/Vite browser SPA, browser workers for ONNX/WASM and vector tracing, pure colour/image helpers, Node test/build scripts. The backend service, its tests/databases, cloud infrastructure, deployment credentials, authentication implementation, and other website features are excluded. No backend was started. Local Vite was bound to loopback on port 5178 without copying environment files.

Evidence labels:

- **Confirmed, runtime**: observed in executed checks, probes, or Safari.
- **Confirmed, static**: complete reachable source path establishes the defect; not yet reproduced in a browser.
- **Suspected / unverified**: requires further measurement, reference fixtures, or environment coverage.
- **Historical**: previous documentation or branch state; not current proof.

Line ranges below refer to baseline `79cf2ca`, before any implementation. P1 = high priority security/core workflow defect; P2 = material correctness, lifecycle, accessibility, or workflow defect; P3 = lower impact polish/maintainability. No P0 incident is established.

## Findings, ordered by severity

### F01 — P1: uploaded SVG can execute in the application DOM

**Confirmed, static.** `src/app/components/SvgConverter.tsx:230–242, 499–515` reads arbitrary file text and passes it to `dangerouslySetInnerHTML` without sanitization or isolation. `accept` on a file input is not content validation. An SVG with event-handler attributes or active foreign content is rendered under the application origin. `vercel.json:1–40` has redirects/rewrites and no application CSP; this audit did not inspect live response headers. Script elements inserted through innerHTML have special execution rules; the finding specifically includes executable event attributes, not a claim that every script tag executes.

Impact: opening a crafted design file can run code with the page’s origin privileges. Fix (small/medium): preview untrusted files through a non-active image resource or properly sandboxed document; validate the SVG root and parse failures, bound dimensions, and prohibit external resource loads. Avoid treating the generated numeric trace output at line 371 as the same trust source as the uploaded text at line 514. Tests: harmless event-handler marker, foreignObject/HTML, external-resource references, malformed XML, valid viewBox-only SVG; no code execution or network request from preview.

### F02 — P1: chosen palette harmony does not determine generated colours

**Confirmed, runtime and static.** `PaletteStudio.tsx:220–245` defines the five mode contracts, but `421–489` never reads `harmonyKey`; `438` calls `pickStrategy()`. `398–418` selects among ten strategies, uses module-global history, and jitters angles. Two fresh engine contexts with identical controlled random choices produce identical complete palettes for Complementary and Triadic. The existing baseline run fails all ten hue assertions.

Impact: the core control promises relationships it does not produce. Fix (medium): use a strictly typed harmony key to select hue positions; put optional random exploration in a separate, explicit control with an injectable random source or variation seed. Remove the retry-until-different loop, which can hang under constant RNG after its first strategy. Tests: every mode’s expected angles, reproducible variations, independent engine instances, fixed RNG, achromatic seeds, and locks that intentionally override a relationship.

### F03 — P1: generated primary foreground is unreadable

**Confirmed, runtime and Safari.** `PaletteStudio.tsx:464–487` adjusts primary against the canvas, then chooses primaryFg from theme alone (`L=.03` for light and `.97` for dark). It never checks primaryFg against primary. Default seed `#6366F1`: light primary `#310FAB` with `#000000` gives **1.78698:1**; dark primary `#6264F7` with `#F4F5F7` gives **4.10875:1**. All ten primary-foreground assertions fail. The preview actually uses this pair at `1138, 1171, 1192`.

Impact: designers export an unusable button pair despite the accessible-palette positioning. Fix (small/medium): choose/solve the foreground against the final, gamut-mapped and quantized primary, after locks/edits; preserve user constraints and report unsatisfiable pairs. Tests: both themes and independent seed fixtures, primary/foreground locks, final hex values, normal versus large text requirements. Never infer palette compliance from a weighted average.

### F04 — P1: displayed APCA is a different calculation

**Confirmed, runtime and reference comparison.** `PaletteStudio.tsx:118–136` first uses the WCAG sRGB transfer function, then raises channels to 2.4 again. It rejects a zero/near-zero luminance outright and omits APCA’s black soft clamp. `562–565` takes absolute values, losing polarity. Probes return **0 Lc for both black on white and white on black**, and about 100.01 for `#777777` on white. Safari shows 0.0 Lc for the high-WCAG-contrast Text/BG pair.

Impact: contrast guidance and score bonuses are misleading. Fix (medium): select and pin a documented APCA version, use its actual transform/black clamp, retain sign, and explain font-size/weight interpretation. APCA must be marked separately from WCAG 2 conformance. Test with independent upstream vectors for both polarities, black, low contrast, equal colours, and near-black rollout. See [upstream APCA source](https://github.com/Myndex/apca-w3/blob/master/src/apca-w3.js).

### F05 — P1: incomplete seed input can publish invalid palette values

**Confirmed, runtime.** `PaletteStudio.tsx:20–26` parses without validating; `857–866` explicitly permits zero to six hex digits after `#`; `880–884` only disables Generate while loading. `771–784` sends the draft directly into the engine, and catches only thrown exceptions. Seed `#12` produces `#NANNANNAN` in primary, primaryFg, secondary and accent rather than an error. Some partial byte strings are accepted by parseInt. Errors from Generate and mood actions are console-only (`780–800`).

Impact: broken output, NaN scores, invalid CSS, and silent failure. Fix (small/medium): separate draft input from a validated committed seed; normalize a documented set of accepted formats; prevent invalid generation and preserve the last valid result with visible inline feedback. Test empty, partial, whitespace, optional prefix/three-digit policy, non-hex, paste, blur, Enter, and recovery.

### F06 — P1: segmentation results can attach to another input/model

**Confirmed, static; historical B2 still present.** `background-removal/BackgroundRemover.tsx:229–239` accepts asynchronously decoded images without an input revision. `281–291` applies every completed mask; `220–226, 303–309` changes model/resets while work is pending. `useBackgroundRemoval.ts:79–83` resets only UI state, not requests. Timeline: start inference A → reset, paste B or choose another model → old inference A resolves → installs A’s mask/history and sets hasResult for the new state. Differing dimensions compound this because `compositing.ts:56–62` accepts mismatched mask lengths.

Impact: wrong cutout or corrupted export presented as the current result. Fix (medium): input/model generation IDs, cancellation/invalidation on reset/replacement/change, ignore stale progress/results, and require exact mask dimensions. Test delayed A/B decode and inference in reversed order; reset, model switch, paste, and unmount mid-job. Do not rely only on disabled Remove: reset/model/paste remain reachable.

### F07 — P2: SVG jobs survive reset and same-engine replacement

**Confirmed, static.** `SvgConverter.tsx:102–163` defers work and later dereferences a nullable canvas; `165–210` awaits vectorization; guards compare only the engine type. `223–227` reset clears visible state but does not invalidate either path. `useVectorize.ts:66–69` resets status only. Raster reads/renders at `230–291` also have no revision guard. A late A result can populate reset output or overwrite B when the engine name is unchanged, or after an engine round trip.

Fix (medium): one input/config job revision across read, decode, worker, encode, reset and mode changes; cancel owned work and discard stale results. Snapshot output configuration with the result. Tests: reset before timeout/decode/worker/toBlob, A→B reversed completion, line→vector→line, and unmount before canvas dereference.

### F08 — P2: worker failures leave pending promises unresolved

**Confirmed, static.** `svg-converter/useVectorize.ts:21–36, 47–61, 71–75` and `background-removal/useBackgroundRemoval.ts:28–48, 60–74, 85–89` update UI on worker.onerror but never reject outstanding requests. Unmount clears the maps without settling callers. Worker construction/postMessage exceptions have no unified cleanup/recovery path. Progress in background removal is applied without checking whether its ID is current (`33–35`).

Fix (medium): define a shared small request-owner helper only after tests establish parity; reject outstanding work on failure/reset/unmount, terminate failed workers, allow a clean retry, and correlate progress. Tests: worker construction error, runtime crash, postMessage error, termination, out-of-order progress, and successful retry. Keep segmentation and tracing domain payloads separate.

### F09 — P2: image/PDF conversion has stale jobs and silent stuck states

**Confirmed, static.** `DesignStudioPage.tsx:718–755` loads/renders PDFs with no cancellation; gotoPage lacks try/finally. `757–772` reset/replacement does not invalidate work. `773–803` lacks image.onerror/catch and returns on a null Blob without clearing converting (`797`). Convert remains enabled (`861`), so repeated jobs race. File validation only checks broad MIME prefixes and no byte/pixel budget; errors from loadPdf clear the input without explanation. Settings can change while an old converted result remains downloadable.

Impact: wrong page/output, stale download, persistent loading, or excessive canvas allocation. Fix (medium/large): a job state machine with read/decode/render/encode error handling; PDF RenderTask/LoadingTask/document destruction; exclusive result ownership; size/output budgets; config-dirty state; disabled duplicate action with explicit cancel/reset. Tests: corrupt image/PDF, invalid drop, password-protected PDF policy, render failure, null Blob, page races, reset/unmount, settings changed before download, and unsupported encoder MIME fallback.

### F10 — P2: object URLs and decoded images lack cleanup owners

**Confirmed, static; historical B1 still present.** Image converter creates original and output URLs at `DesignStudioPage.tsx:767, 791, 798` and never revokes them. SVG image URL at `SvgConverter.tsx:94` is not revoked on replacement/reset/unmount; raster URLs are revoked on some replacement paths (`238, 285, 304`) but not unmount. Background remover never closes its accepted source bitmap on replacement/reset/unmount (`BackgroundRemover.tsx:229–239, 303–309`); only the intermediate downscale bitmap is closed in `compositing.ts:38`.

Fix (medium): a per-resource owner that revokes/closes on replacement, failure and unmount, accounting for stale asynchronous allocations. Tests: instrument create/revoke and bitmap.close, repeated upload/reset/navigation, delayed results, and download lifetime. Halftone already revokes decode URLs on success/error (`HalftoneStudio.tsx:41–45`); do not label that path as the same leak.

### F11 — P2: SVG raster download extension can disagree with the bytes

**Confirmed, static.** `SvgConverter.tsx:283–288` stores an encoded Blob URL, but `294–299` names the file from the *current* rasterFormat. Convert PNG → choose JPG without reconverting → Download names PNG bytes `.jpg`. Scale/quality changes also leave stale output presented without warning.

Fix (small): save MIME/extension/settings with the encoded result and show stale settings or invalidate it. Test PNG→JPG and JPG→PNG without reconversion, config changes during encode, decoded dimensions and actual Blob MIME.

### F12 — P2: accessibility grades are rounded and use an undefined label

**Confirmed, runtime boundary probe and static.** `PaletteStudio.tsx:565` stores ratios as two-decimal strings; `711–716` grades these strings. A raw ratio of 4.499 becomes 4.50 and is marked AA. Ratios 3–4.5 are called **AA+**, which is not the normal-text AA requirement, while the sample at `1248` is 13px/500. The same grade is used in the colour-blind tab. WCAG requires at least 4.5 for ordinary text and 3 for large text; values must not be rounded up to pass ([W3C guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)).

Fix (small): retain raw ratios through evaluation, round only display; give separate normal/large/UI results with size guidance and no overall pass claim. Tests just below/at/above 3, 4.5, 7; a 13px specimen; and raw versus displayed value.

### F13 — P2: “ΔE Distance” and “Quality Score” overstate what is measured

**Confirmed, static and Safari score observation.** `PaletteStudio.tsx:168–174` converts cylindrical OKLCH to scaled **OKLab**, then feeds it to CIEDE2000 at `575–577`, a formula for CIELAB. `584–591` combines clipped, averaged role distances with weighted contrast bins and APCA bonuses. `980–989` calls these Quality Score and ΔE Distance %. There is no quality validation dataset in this audited scope; the Figma-analysis comments at `391–396` do not establish one. A failing critical pair does not prevent a green score.

Fix (medium): use a documented metric in its actual colour space, with correct units; label any aesthetic score as a transparent heuristic and give pair failures priority. Include actual preview combinations, Info/InfoBg, surfaceElevated and semantically relevant distinguishability; scoring currently omits some of them (`542–555`). Tests: independent colour-distance references, identical colours, symmetry, pair coverage, and a high-average/critical-pair-failure palette. This is a correction to the current algorithm’s contract, not grounds to silently replace all colour generation.

### F14 — P2: colour-blind simulation has no defensible model contract

**Confirmed implementation; scientific accuracy unverified.** `PaletteStudio.tsx:336–348` applies unexplained rounded matrices directly to gamma-encoded RGB. `595–606, 1286–1355` reports two ratios and WCAG-like grades from that transform as a Simulation. It does not check confusion between success/error/warning, or disclose model/severity/limitations. This is not an independently verified Brettel, Viénot, or Machado implementation. Linear-light/LMS models require their specified transforms ([DaltonLens model explanation](https://daltonlens.org/understanding-cvd-simulation/)).

Fix (medium): choose a documented model and version, verify fixtures and transfer functions, identify simulated output as approximate, and evaluate relevant semantic pairs without claiming disability-specific compliance. Tests: published/reference vectors, neutrals, extremes, all supported modes, and semantic ambiguity fixtures. Do not “fix” this by just linearizing the current unexplained matrices.

### F15 — P2: palette controls, mood, and output have ambiguous state relationships

**Confirmed, static.** `PaletteStudio.tsx:754–765` stores inputs, palette, score, simulation and visual palette separately. Harmony/seed/theme controls only change draft settings (`851, 861, 872, 905`), leaving previous outputs visible with no dirty indicator. Mood mode/reroll uses the current draft seed (`787–802`) while accessibility/preview/export still describe the last generated UI palette. Main generation always regenerates mood independently (`779`). There is no individual swatch editor (`1045–1072` only copy/lock), nor saved light/dark comparison.

Fix (medium): explicit committed generation snapshot + draft controls; derive analysis from final colours, and either define Mood as a clearly separate exploration or provide explicit Apply-to-role. Add role editing and paired theme comparison. Locks currently preserve the bytes across regeneration (`530–532, 804–810`); retain that useful behaviour, but re-evaluate pairs after overrides and show when locks prevent harmony/contrast targets. Tests: change each control, generate, lock/edit, theme switch, mood reroll, export, clear locks, and async generation snapshot.

### F16 — P2: copy/export reports success even when writing fails

**Confirmed, static.** `PaletteStudio.tsx:814–827, 1409–1412` swallows clipboard rejection and immediately shows Copied. Missing clipboard APIs can throw before the promise exists. Timeout owners are not cleared. CSS naming is internally fixed, camelCase→kebab-case, and covers all 18 current UI slots; no arbitrary user-controlled CSS key injection is established. However invalid generated values are not validated, export has no metadata/theme identity, and the mood result cannot be exported as a set.

Fix (small/medium): await success, provide visible failure plus selectable/downloadable fallback, validate values, and export a complete named light/dark palette with schema/version metadata where appropriate. Tests: clipboard denied/unavailable, successful copy, back-to-back feedback timers, exact CSS keys, parser-valid hex, theme snapshots, and mood export policy.

### F17 — P2: grid inputs allow impossible geometry and misleading measurements

**Confirmed, static and arithmetic.** `DesignStudioPage.tsx:1231–1234` calculates colW/rowH without fitting gutters/margins. Allowed controls at `1239–1247` permit negative field sizes: A4 default inner width 714, 16 columns and gutter 60 gives **(714−900)/16 = −11.625px**. Numeric custom dimensions at `1271` merely set browser min/max; handler accepts zero, negative, fractional and excessive values. Landscape is displayed but ignored for Custom (`1168–1169`). Column/baseline row stats use params.rows even though the column renderer uses one row (`937–939`).

Fix (medium): pure validated geometry model with format/orientation rules, usable-area constraints and system-specific measurements. Reject invalid inputs before drawing and disable impossible output. Tests: the negative-width case, custom clearing/negative/oversized values, orientation, one column, zero gutter, row applicability, restored snapshots. Verify the golden-ratio renderer separately: `979–1005` draws rectangles named squares and hand-built arcs; mathematical fidelity remains unverified.

### F18 — P2: grid measurement helper is called with the wrong arguments

**Confirmed, static and typecheck.** `DesignStudioPage.tsx:928–933` defines arrH(x1,y,x2,val,col?), but `960–961, 975, 1026, 1121–1122` pass an extra coordinate before the label. Numbers become text and strings such as “166px col” become invalid stroke colours; six-argument calls discard the intended colour. Typecheck reports these call sites. The baseline helper also draws vertical-looking dimensions with a horizontal tick convention at `975`.

Fix (small): typed horizontal/vertical measurement primitives with named coordinate/value fields. Tests: fake-canvas recorded arguments or actual canvas labels with known dimensions, all affected grid modes, and scoped typecheck diagnostics eliminated.

### F19 — P2: grid history trusts persisted data and can lose recent changes

**Confirmed, static.** `DesignStudioPage.tsx:1134–1139` accepts any array as GridSnapshot[]; `1313` dereferences r.params.cols directly and `1236, 1295` assume a valid system. A parseable malformed local record can crash the tool. Save waits 700ms and its cleanup discards pending work on tool switch (`1202–1214`). Readiness uses a time-based 450ms flag (`1195–1198`), so early user changes can be missed. Restore uses an unowned zero-timeout guard (`1216–1223`).

Fix (small/medium): versioned runtime validation, bounded records and numeric constraints, event-based initialization, explicit save/flush semantics on leaving. Tests: malformed/null/unknown records, storage denial/quota, first interaction under 450ms, navigate before 700ms, restore preset and custom, dedup/cap and Clear.

### F20 — P2: font loading requests invalid weights and has no reliable status

**Confirmed URL construction; network outcome unverified.** `DesignStudioPage.tsx:273–275` requests weights 300/400/600/700/800 for every family, including single-weight faces (e.g. DM Serif Display at `93`) and unavailable catalogue names such as the locally licensed Rockwell/Gill Sans pair (`130`). Display weight 900 is used at `190, 238` but is not requested. `292–299` appends stylesheets without load/error/cleanup state. Preview can silently use fallback or synthesize the named weight.

Fix (medium): catalogue-supported family/weight metadata; request the actual role weights, handle same-family union, show loading/fallback/error status, and offer correct specimen/licensing links. Validate external requests before promising exact availability. Tests: regular-only font, 900-weight pair, same-family two weights, blocked/offline font host, failed stylesheet, and selected font confirmation. No dependency replacement is needed.

### F21 — P2: font score is editorial metadata presented as measurement

**Confirmed, static.** `DesignStudioPage.tsx:337–340` assigns category 92 or 65, x-height 96 or 72 from a hand-authored Boolean, and a three-bin weight score. `383, 426–438` calls this Matched x-height and Pairing score. No font metrics are measured. History stores only strategy/index (`283, 301–335`), truncates forward entries correctly, and resets on tool unmount. It creates unbounded unlabeled 7px buttons (`460–467`). The size slider says up to 96px (`450`) but rendered size is capped at 80 (`393`).

Fix (small/medium): describe the pairs as curated suggestions with qualitative rationale; label any retained heuristic; make size match preview, and present bounded accessible recent-pair entries with named Back/Forward. Decide explicitly whether history persists across tool switches. Tests: strategy/generate/back/forward/branching, size 80/96, meaningful accessible names, bounded history, and tool-switch policy.

### F22 — P2: upload controls and form relationships block keyboard/screen-reader use

**Confirmed, static and partial Safari accessibility-tree inspection.** Image dropzone is an onClick div with a display:none input (`DesignStudioPage.tsx:808–818`); background upload is similar (`BackgroundRemover.tsx:401, 428–455`); SVG and halftone use non-focusable labels with hidden inputs (`SvgConverter.tsx:351–354, 500–503`; `HalftoneStudio.tsx:114–117`). Numerous labels are adjacent text without htmlFor/wrapping: font size/text (`445–450`), contrast (`623–634`), grid (`1345–1346`), SVG sliders, halftone Slider (`7–19`) and controls. History buttons have no name. Palette tabs (`937–953`) lack the complete keyboard/tab-panel relationship; lock buttons have a changing name but no pressed state.

Fix (medium): real Browse buttons with hidden native file inputs activated by those buttons, explicit labels/descriptions/error relationships, named icon buttons, selected/pressed state, and an accessible tabs pattern or simpler ordinary buttons. Preserve the existing global focus shadow (`theme.css:207–210`); do not claim all controls lack focus merely because they set outline:none. Verify the invisible native colour input’s visible focus at its wrapper. Tests: keyboard-only full journey, accessible names, tab arrow keys/Home/End if tabs, Space/Enter browse, focus recovery on reset/error/switch and status announcements.

### F23 — P2: narrow layouts have fixed widths and competing inline styles

**Confirmed constraints; mobile visual extent unverified.** `DesignStudioPage.tsx:1428` reserves 48px on each side at every width. Palette content adds another 24px (`PaletteStudio.tsx:1723–1726`), while its dashboard preview is width 400/flexShrink 0 (`1132`). SVG preview columns have a 300px minimum (`SvgConverter.tsx:358, 507`) plus nested padding. Image preview always uses two columns (`DesignStudioPage.tsx:821`); grid stats always use four (`1324`). Halftone sets inline flexDirection:column and width:100%, which override the intended lg:flex-row/lg:w-80 classes (`HalftoneStudio.tsx:91–94, 123–127`). Root overflow-x:hidden (`globals.css:7–13`) can conceal overflow rather than making content fit.

Fix (medium): shared scoped shell with responsive gutters; minmax(0,1fr), single-column mobile preview/control stacking, wrapping or clearly scrollable tool navigation, correct class/inline ownership, and readable values. Test/screenshot 320/375/768/1440 widths, 200% zoom, long labels and every loaded tool. Background remover already has a 720px single-column override (`643–644`); preserve it until the shared layout replaces it safely. Native Safari desktop screenshots were inspected; a complete mobile matrix has not been certified.

### F24 — P2: halftone controls and export do not share a clear processing contract

**Confirmed, static; performance severity unmeasured.** `HalftoneStudio.tsx:38–46` rejects invalid types/decode errors silently and has no input revision. Rendering is synchronous inside requestAnimationFrame (`56–68`), not off-thread; source is bounded to 700px and cached, so historical B3’s suggestion of unbounded original-resolution work would be inaccurate. Export writes that 700px canvas without resolution disclosure (`76–81`). Detail slider is always visible (`149`) but `halftone-logic.ts:54–80` only uses resolution for lines, so it does nothing for dots/squares. After loading, Browse disappears; Reset restores settings only (`169`), not the source. Alpha is ignored in brightness samples (`halftone-logic.ts:37–43`).

Fix (medium): visible validation/decode/processing/error states, input revisions, applicable controls only, Replace/Clear versus Reset settings, explicit working/export dimensions, and transparent-source policy. Profile worst supported settings before choosing worker/debounce changes. Tests: all three styles, detail applicability, transparent pixels, invalid image, decode races, replacement/reset, output dimensions; measure frame stalls on target devices before performance acceptance.

### F25 — P2: background compositing overwrites original alpha

**Confirmed, static arithmetic.** `background-removal/compositing.ts:56–62` and `refine.ts:83–86` assign mask alpha directly. A source pixel with alpha 0 and mask 255 becomes opaque; partially transparent input can also become fully opaque, including Restore edits.

Fix (small/medium): define sourceAlpha × maskAlpha / 255 as the maximum retained opacity and use it consistently in full and dirty-region compositing (unless the product explicitly introduces opacity reconstruction). Tests: 0/128/255 source alpha × 0/128/255 mask, brush restore/erase, undo/redo, transparent export, and flattened backdrops.

### F26 — P2: vector postprocessing adds opaque corner blocks indiscriminately

**Confirmed, static output construction; visual prevalence unverified.** `svg-converter/vectorize.worker.ts:21–24, 72–88` adds four rectangles up to 300×300 with sampled RGB and no alpha. This runs for every preset, including binary and pixel modes, regardless of whether overshooting paths exist. Transparent corners therefore receive opaque paint; exposed fitted-path gaps can receive large uniform sampled blocks unrelated to the actual region.

Fix (medium): establish trace output bounds and alpha fixtures; remove unconditional invented geometry or constrain a documented correction to the actual affected shape with verified coverage. Preserve viewBox and clipping fixes. Tests: transparent/pixel/binary/photographic fixtures, different corner colours, small images with overlapping corner rectangles, portrait dimensions, and export versus preview equivalence. Do not change presets based only on comments about earlier experiments.

### F27 — P2: CI does not protect the real palette contract

**Confirmed, executed.** `vitest.config.mts:10–15` includes only src/**/*.test.ts; the standalone `tests/palette-engine.test.js` is excluded. `package.json:7–11` and `.github/workflows/ci.yml:127–128` invoke only Vitest. The standalone script imports undeclared direct dependency esbuild (`tests/palette-engine.test.js:6`), so a clean strict pnpm install initially cannot run it. After a node_modules-only link to the installed transitive esbuild, it reports 110/130 passing. Its randomness and copied conversion code weaken oracle independence; its gamut assertion only checks serialized hex, not pre-map accuracy (`173–195`); the “all unlocked change” assumption (`220–226`) is not valid for intentionally fixed semantic roles.

CI counts errors rather than matching diagnostics (`ci.yml:130–144`), allowing a new error to replace an old one while remaining at 16. PaletteStudio opts out of checking entirely (`PaletteStudio.tsx:1`). Fix (medium): migrate engine contracts into the discovered suite, make randomness explicit, add independent reference cases and UI workflow coverage, remove ts-nocheck incrementally, and compare unrelated baseline diagnostic identity until it can be resolved separately. Tests: discovered palette cases actually execute/fail on baseline, algorithms and reducer transitions, browser integration, and no new diagnostics. Do not require unrelated website repairs to pass this scoped change.

### F28 — P3: tool navigation replaces history and destroys work

**Confirmed, static.** `DesignStudioPage.tsx:1403` replaces the current history entry and all query parameters; `1416–1440` renders only the active component, unmounting the previous tool. Direct ?tab links and refresh work for valid tabs, and invalid IDs fall back to palette (`1395–1401`). However Back cannot walk prior tool selections, and switching away discards inputs/results/font history. Homepage state links (`DesignStudioCard.tsx:66`) are promoted only on initial mount (`1407–1414`). Two distinct registries and subtitles require manual synchronization (`DesignStudioCard.tsx:8–17`; `DesignStudioPage.tsx:1362–1381`).

Fix (medium): one typed tool registry and canonical shareable query link; preserve unrelated query values; push meaningful navigation history; explicitly define draft persistence and cancellation on leave. Preserve lightweight drafts rather than keeping every heavy worker/model mounted. Tests: direct URL, invalid tab, refresh, homepage link, Back/Forward, repeated state navigation, and return-to-tool policy.

### F29 — P3: embedded palette loses its lock and reroll icon font

**Confirmed, static and desktop screenshot.** Only `PalettePage.tsx:13–18` loads Tabler webfont CSS, using an unpinned @latest URL; embedded `PaletteStudioWrapper` (`DesignStudioPage.tsx:1357–1359`) does not. Palette lock/reroll icons depend on those CSS classes (`PaletteStudio.tsx:1067–1070, 1395`). Safari’s fresh Design Studio screenshot has blank lock affordances despite named buttons in the accessibility tree. Standalone /palette also lacks its own title after the title-removal refactor (`PalettePage.tsx:21–24`; `PaletteStudio.tsx:837–838`).

Fix (small): use the existing local lucide-react icons consistently and a shared palette shell/title contract. Test a fresh direct load of each route without prior /palette visitation, blocked external CDN, visible lock/pressed state, and one useful page heading. The PalettePage effect cleanup also causes an existing type error by returning removeChild’s value.

### F30 — P3: reduced-motion handling is absent from the scoped interactions

**Confirmed, static.** Homepage card animates into view (`DesignStudioCard.tsx:22–27`); palette swatches mutate translateY on hover (`PaletteStudio.tsx:1036–1042, 1416–1422`); loading indicators spin. No prefers-reduced-motion branch or MotionConfig was found in active src/styles/tool paths. Existing focus design tokens and dark/light theme tokens are useful and should remain.

Fix (small): scoped reduced-motion styles/hooks; make processing state understandable through text independent of motion; avoid suppressing necessary feedback. Test reduced motion, keyboard focus, dark/light themes, and status text. Separate decorative movement from functional image manipulation.

## Existing feature and control inventory

This is an inventory from actual handler tracing, not a declaration that every browser/codec/device has passed QA.

| Tool | Existing controls and behaviours | Gaps / preservation requirements |
|---|---|---|
| Palette | Seed picker/hex, light/dark draft, five harmony buttons, Generate, 18 copy swatches, locks/Clear all, CSS copy, Palette/Accessibility/Color Blind/Mood tabs, five moods/reroll, UI preview | Preserve roles/locks/mood choices; fix F02–05/F12–16; add per-role edit and honest variants. Preview controls are illustration divs, not working application buttons. |
| Font | All + seven filters, random pair, Back/Forward, history jump, editable sample, size slider, external specimen links | Curated finite catalogue, not “infinite”; history branching is present. Fix load contracts, score honesty, max size and accessibility. |
| Contrast | Two picker/hex drafts, swap, live ratio, five thresholds, replacement suggestions/apply | Main valid-hex luminance works for 8-bit reference cases. Invalid draft text leaves last valid calculation displayed without warning; swap may preserve invalid drafts. Lightness suggestion starts at black or white rather than the nearest acceptable original (`511–532`); dark label can describe a light result. Make suggestions nearest-change and pair-specific. |
| Image/PDF | Browse/drop, image preview, PDF page navigation, PNG/JPEG/WebP/PDF output, lossy quality, 10–200% scale, Convert/Reset/Download | Preserve PDF lazy loading and PDF raster preview. Fix F09–10; flatten alpha explicitly for JPEG (SVG rasterizer already does so, image converter does not). Reject zero-pixel scaled output. |
| Grid | Nine formats including Custom, orientation, nine grid systems, system-specific sliders, canvas metrics, ten local recents/restore/Clear | Preserve breadth; no download/CSS grid export exists. Grid export can be a later enhancement, not a prerequisite for correctness fixes. Fix F17–19. |
| Halftone | Browse/drop, lines/dots/squares, angle/spacing/detail/contrast/brightness, invert, two colours, Reset settings, PNG export | Preserve bounded cached processing; improve replacement, transparent inputs, applicability and export resolution disclosure. |
| SVG | Image→SVG/SVG→Image, Line/Vector engine, threshold/fill/invert/thicken, three vector presets, binary/colour/path mode, advanced sliders, Convert/Reset/Download, PNG/JPG quality/scale | No drop handlers currently exist despite other tools supporting drop. Keep presets, proper viewBox and clipping. Fix trust, races, resources and format identity before polish. |
| Background removal | Validated picker/drop/paste (25 MiB limit), two models, download/init/infer progress, Remove/Re-run/Reset, checker/white/black backdrop, PNG, restore/erase, soft/hard brush, size, undo/redo + keyboard shortcuts, downscale notice | Preserve local processing, model limitations, 2560px cap, 15-state refinement history. Fix F06/08/10/25 and show load/export errors. Brush canvas is pointer-operated; keyboard-accessible surrounding controls and instructions still need QA. |

Additional traced concerns: segmentation cache open/match/put failures are fatal even if the model downloaded successfully (`model-cache.ts:11–15,24,41`); cache should be optional. Image decoding and PNG export promises in BackgroundRemover are not caught (`229–239,293–301`), and reject feedback is only rendered in its empty state (`456–459`), so rejected paste while an image is loaded can be invisible. These belong in the same lifecycle/error-state scope as F06/F09/F10, with cache-denied/corrupt-image/export-failure tests. Worker session creation is cached only after await (`bg-removal.worker.ts:33–45`), so overlapping requests can create duplicate sessions; test it once cancellation/ownership is established. Model inference quality, tensor disposal, and brush pointer-cancel history require runtime profiling/fixtures before stronger claims.

## Colour-engine conclusions and independent checks

`src/app/lib/color-engine.ts` is a separate **unused HSL engine**: repository-wide imports/callers do not reach it. Its harmony generation at 102–139 does select by mode; fixing it would not repair F02. Its hex parser (`62–69`) can accept partial hex bytes despite checking length, and its scheme/score detection is simplistic (`173–238`, notably any four-plus hues become tetradic). Treat these as dormant maintenance concerns, not live UI defects; do not casually replace the current OKLCH implementation with this file.

The active WCAG core (`PaletteStudio.tsx:108–115`) returns independent known values: black/white 21, identical colours 1, and #777777/white 4.4780894536. The contrast checker’s older 0.03928 transfer cutoff (`DesignStudioPage.tsx:483–488`) produces the same results for 8-bit hex around that cutoff; it is duplication to consolidate, not evidence of a material current numerical failure. Threshold classification and applied pairs still need F12/F13 fixes.

OKLCH conversion returns red approximately L=.62795536, C=.25768331, h=29.233885°. Black/white/R/G/B/#777777 round trips return their original 8-bit hex. This supports basic conversion sanity, not complete gamut correctness. Gamut mapping reduces chroma at fixed L/H using a .001 RGB tolerance (`PaletteStudio.tsx:78–101`) and then clamps serialization. It must be tested against independent out-of-gamut fixtures, extreme L/chroma, finite-number validation and achromatic hue policy. Do not claim it is the CSS Color 4 gamut-mapping algorithm.

The lightness search has an additional confirmed correctness issue: `143–161` and `370–384` update binary-search bounds in the opposite direction from finding the nearest passing boundary. Neutral L=.8 on white with target 4.5 returns ~.05, a near-black endpoint. This contributes to excessive darkening in F03’s generation path. Define the nearest feasible candidate and verify the final quantized contrast, including impossible constrained targets; test both search directions, black/white seeds and locked backgrounds.

No palette-wide accessibility pass is established. Only specifically evaluated pairs, text sizes and conditions can receive a result. Surface/semantic foreground coverage must match actual preview and exported role usage, including applied opacity in the preview (`PaletteStudio.tsx:1148`).

## Verification and CI baseline

Environment: macOS arm64, Node **22.22.3**, pnpm **11.6.0**, TypeScript **5.9.3**, Vitest **5.0.1**, Vite **6.4.3**, React **18.3.1**. Shell initially selected Node 20.13.1, which fails to run pnpm 11 because node:sqlite is unavailable. Commands below explicitly selected the installed Node 22 bin directory. This is an environment mismatch, not a new application defect.

| Command | Actual result | Limits |
|---|---|---|
| pnpm install --frozen-lockfile --ignore-scripts | exit 0, 447 packages installed from existing cache | Created ignored node_modules; did not mutate tracked lockfile. Scripts deliberately not executed. Required native tooling worked in subsequent build. pnpm warns package.json pnpm.overrides is ignored by v11. |
| pnpm test | exit 0: **16 files, 234 tests passed** | Node environment; source guards/pure helpers, no full studio integration tests. |
| pnpm typecheck | exit 2: **16 TS diagnostics** | Existing baseline, not clean. Seven DesignStudioPage, one background worker, one PalettePage; seven elsewhere. Full log attached. |
| pnpm build | exit 0, **6.72 seconds** | Large-chunk warnings. Models and worker/WASM assets emitted; actual inference/browser compatibility not certified. |
| node scripts/check-route-collisions.mjs | exit 0: **13 route segments, 7 root entries, no collisions** | Checks emitted output, not deployed hosting. |
| node tests/palette-engine.test.js (clean pnpm install) | exit 1, ERR_MODULE_NOT_FOUND: esbuild | Undeclared direct test dependency. |
| Same script after node_modules-only link to installed esbuild | exit 1: **110/130 passed, 20 failed** | Ten harmony + ten primaryFg assertions in this actual run. Randomness means exact hue failures can vary on another run. |
| Temporary source-bundled colour probes | exit 0; known WCAG cases, invalid seed, APCA extremes, mode independence, rounding, OKLCH round trips, lightness search reproduced | Diagnostic probes were not installed as production tests. See artifact and source. |
| Safari local desktop | Generated palette, read score and accessibility panel, inspected screenshot | Confirmed 1.79 primary pair, high overall score, zero APCA text pair, missing icon appearance. New loopback tab only. |
| Responsive Safari | Responsive preview opened; 375px width selected | Viewport-height operation was interrupted when Safari returned to another user-controlled tab; no further actions were sent to that tab. No complete mobile/tablet screenshot certification claimed. |

Historical FIX_TASKS.md B1 and B2 remain in source; B3 is partially mitigated by RAF batching, 700px cap and cached ImageData, but work still runs synchronously on the main thread. UX3’s silent rejected upload remains. QW2 claims palette tests were wired in; current scripts/config prove they are excluded. Historical documents disagree on tool count: current registry has eight. No historical assertion is treated as a passing test.

Artifacts in [studio-audit](studio-audit/): frontend-tests.txt, typecheck.txt, production-build.txt, palette-baseline.txt, colour-probes.json and colour-probes.mjs. Reproduce probes from the worktree root with Node 22 after exposing the existing esbuild installation as described in F27; no new dependency manifest was written. The probe script writes its JSON to /private/tmp. Logs contain local build paths, not environment files.

Caches/build artifacts created: node_modules (including the diagnostic esbuild symlink and Vite cache), dist, and temporary logs/probes under /private/tmp. Only this report/evidence directory is intended as a review artifact. No broad cleanup was run. No lint script exists. Backend/DB suites and remote CI jobs were not run; no production QA performed.

## Recommended boundaries

1. **Typed pure palette domain** under src/app/lib/palette/: validated RGB/OKLab/OKLCH conversion and mapping; harmony contract; semantic-role generation; pair registry + raw WCAG/APCA analysis; documented simulation; serialization. Keep references and provenance with algorithms. Preserve current transforms that pass independent cases; change only demonstrated defects and approved policies.
2. **Palette editor state**: a reducer/hook owns draft seed/settings, committed input snapshot, role edits/locks, coherent light/dark variants and explicit variation state. Analysis is derived from the final palette rather than stored independently. Mood exploration is named separately and can only affect tokens via an explicit Apply action.
3. **Studio registry and shell**: one typed registry exports tool ID/label/description/icon/lazy component/query link for page and homepage. Extract FontPairing, ContrastChecker, ImageConverter, GridCalculator from the 1,445-line page along their existing component boundaries. Do not modify other homepage content or shared site navigation as incidental redesign.
4. **Small shared primitives**: ToolHeader, segmented choices, labeled fields, accessible UploadZone, processing/error/status area, PreviewPanel, result/download actions. Compose established button/card/input/focus/theme tokens; scope new CSS to the suite. Unify semantics, not image algorithms.
5. **Media job/resource ownership**: explicit input/config revision, cancel/reset/unmount handling, owned object URLs/ImageBitmaps/PDF tasks, decode/output budgets, and result metadata. Keep ONNX/vtracer lazy and domain-specific. Extract a worker-request primitive only for proven common request-settlement behaviour.
6. **Grid/font data and pure logic**: typed font catalogue/weight metadata and history transitions; pure validated grid geometry/snapshots separated from imperative rendering. Do not add a generic cross-site framework.

## Proposed professional UX and visual direction

Retain the neutral DNA canvas, lifted surfaces, restrained pink brand accent, Inter/Mona hierarchy, existing radii and focus shadow. Use one purposeful header and tool navigator; reduce duplicate vertical padding and nested card padding. Controls should be readable at 13–15px rather than relying on 8–10px preview text for actionable information. Use local Lucide icons and text labels for primary actions. Display active, disabled, modified, loading and failure states consistently.

Palette journey: seed + validated hex → named harmony (with angle explanation) → Generate → role swatches with Edit/Lock/Copy → paired Light/Dark selector or comparison → realistic responsive preview → pair-based Accessibility → Export. Put semantic tokens and model details behind discoverable sections; show critical failing pairs before optional aesthetic guidance. Distinguish global site theme from generated palette theme. Keep dirty-input feedback visible until regeneration. Locked/edited colours remain exact, with a clear explanation when that prevents target harmony or contrast.

Media journey: one keyboard-accessible browse/drop surface with actual supported formats and limits → decoded source metadata → clearly labeled settings → one primary Process action with progress/cancel → current result metadata and dimensions → named download. Show Replace, Clear input, and Reset settings distinctly. Settings that change after processing mark output out of date. Work in progress must never replace a newer input. Keep privacy copy accurate about local image processing, without implying that fonts/model downloads require no network.

At desktop, show preview + a bounded control column; at tablet/mobile, stack in task order. Use min-width:0 and responsive gutters, preserve readable numeric values, and keep primary actions reachable without clipping. Tool links should work with browser Back/Forward and be shareable. Decide per-tool lightweight draft retention; terminate heavy work on leave. Respect reduced motion and retain visible focus in both site themes.

## Prioritized implementation plan and acceptance criteria

This is the proposed Phase 3 scope. Approval of this report authorizes implementation only; merging/deploying remains a separate explicit decision.

| Stage | Scope | Acceptance criteria |
|---|---|---|
| 1. Establish executable contracts and close SVG injection | F01/F27; focused engine/reference tests and harmless SVG security fixture | Palette tests discovered by pnpm test; independent WCAG/APCA/colour fixtures; untrusted SVG never enters active application DOM; no external preview resource fetch; all baseline failures explicitly classified rather than skipped. |
| 2. Correct palette domain | F02–05/F12–14 and nearest-lightness search | Each chosen mode controls documented hue offsets; optional variation reproducible; invalid seeds cannot generate/export; raw thresholds; actual primaryFg/primary AA normal-text check; signed versioned APCA; distance/model labels match validated algorithms; achromatic/gamut edge cases covered. |
| 3. Implement palette editing workflow | F15–16/F29 | Edit any role; lock exact bytes across seed/mode/regeneration; unlock resumes generation; light/dark comparison coherent; analysis/preview/export all reference committed final values; mood relationship explicit; copy failure truthful; all 18 roles export with valid values and complete theme identity. |
| 4. Own asynchronous media work | F06–11/F25–26 plus model/cache/decode/export failures | Reset/replacement/model switch/unmount invalidate results/progress; promises settle on crash/cancel; URL/bitmap/PDF cleanup verified; current MIME/dimensions/settings travel with results; null/throw/decode failures recover; source alpha preserved; no fabricated opaque corner fill. |
| 5. Correct secondary tool behaviour | F17–21/F24 | Grid never draws impossible geometry; measurements match displayed system; snapshots validate/restore; orientation works for Custom; font weights load honestly or show fallback; score described as curation; size matches slider; applicable halftone controls and export dimensions explicit. Profile before accepting any worker-performance change. |
| 6. Unify suite shell and accessibility | F22–23/F28/F30, component extraction and typed registry | Every visible control has an expected-behaviour check; keyboard browse/edit/lock/generate/convert/download/reset/switch works; labels/focus/selection/status correct; 320/375/768/1440 widths and 200% zoom fit; both themes and reduced motion verified; direct links, refresh, Back/Forward and return-to-tool draft policy tested. |
| 7. Verify and prepare review | Relevant existing tests, integration, scoped types, build, screenshots | Unit + integration + actual browser workflows pass; remove nine existing audited-path diagnostics and add none elsewhere; compare remaining diagnostic identities, not count alone; production build + route-collision guard pass; before/after desktop/mobile screenshots, exact changed-file list and limitations prepared for PR. No deployment/merge. |

Out of the first implementation scope: other website pages, backend/storage/auth, broad dependency upgrades/removal, production settings, cloud infrastructure, a new grid export feature, subjective replacement of the entire palette aesthetic, and new paid services. Reuse the installed stack. Any test-only dependency needed for browser/DOM integration must be narrow and justified after reviewing existing available tooling; no package change is pre-made by this audit.

## Unverified concerns and residual limitations

- Full mobile/tablet/browser matrix, file-picker journeys, downloads and cancellation timing remain to execute. Static control tracing is not equivalent to browser success.
- SVG injection is confirmed from the reachable source/DOM sink; no active payload was executed in the user’s regular browser and live hosting headers were not inspected. The regression test should run in a disposable isolated browser context.
- Colour-blind model fidelity, full independent gamut mapping corpus, CIEDE2000 reference vectors and model output quality need dedicated fixtures. APCA’s implemented failure at black/white is already established independently of these gaps.
- ONNX runtime performance, cache quota/private mode, original alpha, device memory, tensor/session disposal, slow network, worker/WASM failures and brush pointer-cancel need runtime cases. General and portrait model files are present in public/models and build output; presence does not prove inference success.
- Golden-ratio geometry and radial/isometric clipping should be checked against a precise mathematical contract before labeling those visualizations accurate drafting aids.
- No package-advisory/license/support sweep was completed. The audit makes no claim that the dependency graph is vulnerability-free. Scope-specific risks here come from traced application behaviour, not guessed package advisories.
- Documentation elsewhere is historical and was not rewritten. Unrelated changes and production systems remain outside the audit.

## Codebase-auditor checklist accountability

**Checklist: 36/46 complete for the skill’s full cross-cutting checklist.** The scoped tool audit and plan above are complete to the stated static/runtime depth; this is not a whole-repository security certification. Required delivery defects lead to FAIL, not a PASS qualified by missing checks.

Ten incomplete skill items are deliberately outside this user-approved surface (global numbering follows the skill’s ordered checkboxes):

| Item | Reason and outcome impact | Exact next action if separately requested |
|---|---|---|
| 8: credential/secret sweep | Excluded; no credential safety assertion made | Load required secret-handling guidance before a dedicated redacted credential audit. |
| 9: credential finding validation | No credential audit performed | Validate only redacted locations/types in the dedicated audit; never disclose values. |
| 11: backend auth/tenant isolation | Browser-local tools need no API identity changes; backend excluded | Trace authorization paths in a separate backend audit. |
| 24: DTO/service/persistence contract | No persistence service contract changed by this scope | Audit backend serialization/storage separately. |
| 25: whole dependency vulnerability/license/support review | Not a dependency maintenance task | Run package-manager advisory analysis and verify reachable versions/licenses separately. |
| 26: package vulnerability reachability | No advisory findings asserted | Trace any actual advisory into used APIs before assigning severity. |
| 27: replacement/library evaluation | No replacement package selected | Verify parity/license/maintenance if a replacement is later proposed. |
| 31: distributed correlation | Browser workers inspected; queues/services excluded | Trace correlation across service/queue boundaries in an operations audit. |
| 36: service startup/shutdown | No long-running backend started | Verify service startup/readiness/draining in an isolated backend environment. |
| 38: liveness/readiness probes | Not applicable to pure browser tools; left incomplete rather than marked done | Check operational probes as part of the separate service audit. |

The checklist exclusions are not an approval requirement. The approval pause comes directly from the user’s pasted brief: **“Implement after the audit is approved.”**
