# Design Studio implementation and validation

Validation date: 5 November 2026. Historical 4 November measurements are retained below and labelled by their source files. Repository: `/Users/venugopal/Downloads/dna_website`.

Release assembly on current main: **483 tests pass, full typecheck clean, build passes; three-engine built-preview checks pass.** See [release reconciliation and fresh validation](release/README.md). The 222-test follow-up below describes the original checkout before integration with newer main. See [independent follow-up](#independent-follow-up-5-november-2026) and [actual output comparisons](output-review.html). Earlier measurements below retain their original context.

## Scope and dependency map

- `/design-studio` → `DesignStudioPage.tsx` → tool registry. Tool switching unmounts the active view; it does not retain every heavy component.
- `/palette` and Studio palette → `PaletteStudio.tsx` → typed pure `palette-engine.ts` → Color.js 0.6.1.
- `color-engine.ts` is an unreferenced legacy helper, not the active palette engine. It was not used as the foundation for the replacement or deleted as an unrelated cleanup.
- Studio halftone → `HalftoneStudio.tsx` → cancellable `halftone-job.ts` → `halftone.worker.ts` → shared geometric renderer. PNG and SVG derive from the same geometry. A preview never becomes the export source.
- Background remover is a lazy route tool → `useBackgroundRemoval.ts` → long-lived typed `processor.ts` → module worker → verified model cache → ONNX runtime. Model/runtime imports are lazy and outside the main entry graph.
- Font pairing → typed six-pair catalogue → five pinned self-hosted OFL families, with preparation-time metadata in `studio-fonts.json`.
- `studio-draft.ts` stores versioned lightweight settings, with session-memory fallback. `image-drafts.ts` keeps bounded session image drafts; explicitly enabled device recovery stores versioned image bytes in IndexedDB. Browser processing remains the default; an explicitly selected optional loopback Python helper is now available (see follow-up below). The backend was intentionally not running during browser QA; pre-existing app data-fetch errors were logged, while the local tools remained functional.
- Design Studio processing has no backend inference route. Existing Node/AWS services were not modified. The pre-existing edits to `backend/src/server.ts`, `src/app/App.tsx` and Vercel dependencies were preserved.

## Processing and workflow changes

### Background removal

- Verified bundled ONNX graphs with `onnx.checker`; recorded shapes, opsets and operators in `model-graphs.json`. U2NETP stays at its static 320² input. MODNet's dynamic graph now uses aspect-preserving multiples of 32, bounded to a 1024px inference edge. This removes square distortion without enlarging a static model beyond its validated shape.
- U2NETP preprocessing now follows reference RGB maximum normalization. MODNet retains `(channel/255 - .5)/.5`. Output handling validates finite values and expected dimensions; sigmoid saliency/matte semantics are retained.
- Source transparency is multiplied by the output mask, including manual brush recompositing and undo/redo. Transparent PNG export excludes checkerboards.
- Single-flight worker processing, rejection on cancellation/crash/termination/timeout, stale request guards, worker recreation on retry, pending request limits and explicit memory release.
- One initialized model at a time. Completed sessions remain warm across tool switches and release after two idle minutes. Switching away cancels active work; completed image/mask drafts can be restored.
- Model downloads and cache hits verify SHA-256 against exact artifacts. Cache denial, quota failures and bad cached entries fall back to uncached verified downloads. Download size is bounded.
- Worker runtime detects a GPU adapter and f16 availability; existing float32 exports do not require f16. General/Portrait WebGPU initialization/inference failure retries through WASM; opt-in Detail never falls back to large CPU WASM inference. Missing GPU uses the smaller CPU runtime. UI identifies the actual selected backend. Model sessions, tensors and source bitmaps have disposal paths.
- Undo/redo snapshots share a 32 MiB history budget; images have a disclosed 2560px working edge. No segmentation-confidence quality score was introduced.

### Halftone

- Source pixels accumulate into rotated screen cells in linear-light luminance; source alpha controls ink coverage over the chosen opaque paper. Fully transparent areas remain clear of ink even when inverted or when paper is coloured. This is O(pixels + cells), with no repeated pixel-neighbourhood scan or point-sampling alias.
- Coverage maps to square-root square size, fractional line thickness and calibrated circle radius, including the overlap range above π/4. Black/white endpoint tests and linear-light stripe tests verify these properties.
- Geometry uses a 700px reference longest edge, preserving size/spacing/rotation/aspect across preview and export. Native canvas geometry provides antialiasing. Preview is at most 700px; export reads the original image.
- Worker-rendered PNG and geometric SVG support at most 16 megapixels, 8192px per edge and 150,000 screen cells. Oversized/complex jobs fail visibly instead of exporting an upscaled preview. Expensive exports have progress, timeout and cancellation.
- Responsive layout conflicts were removed. Sliders/colour/invert controls have accessible names. Transparency intentionally composites onto an explicit opaque paper colour; no print-colour accuracy claim is made.

### Palette

- Active numerical/generation logic was extracted into a typed, React-independent engine, and `ts-nocheck` was removed from the existing view.
- Color.js supplies conversions, gamut mapping, WCAG contrast and CIEDE2000 with actual CIELAB data. The handwritten APCA approximation was removed. It is neither shown nor scored.
- Selected harmony controls generation. Local seeded randomness gives reproducible variants and shareable versioned recipes; no fabricated reference dataset or global random strategy overrides the user's choice.
- Contrast search considers lighter and darker solutions against rounded/gamut-mapped colours and reports impossible targets. Foregrounds use actual contrast, including button and swatch labels.
- Locked/edited roles are retained; unlocked dependent roles are repaired against their intended backgrounds. Unsatisfied constraints remain visible. Accessibility reports list individual foreground/background role checks; a pass-rate summary is not proof that every role passes.
- Creative palettes have a separate workflow. Named harmonies preserve their hue angles; only Exploratory relaxes them. Creative swatches are not all required to contrast against one another.
- Clipboard/generation errors are visible. Settings, roles and creative drafts recover across tool switches/refresh; parsed persisted values are validated.
- The pre-existing standalone suite is included by the standard Vitest workflow. Its obsolete assertion that *every* unlocked colour must change was narrowed to structural roles: the correct black/white button foreground can remain unchanged across generations. Lock and contrast assertions were retained.

### Fonts and shared reliability

- Removed the unverified 147-pair catalogue and fabricated category/x-height scores. Six editorial pairings use individually verified weights, Latin/Devanagari selection and plain suitability reasoning.
- `FontFace` loads only selected normal styles, confirms load completion, reports errors/timeouts and releases registered faces on changes/unmount. No accumulating remote stylesheets. Editable headline/body specimens use the selected weights and the full 24–96px slider range.
- Export includes usable font-face and typography CSS with sizes, weights, line heights, fallbacks and font/licence download links. Metrics come from upstream font OS/2 tables at preparation time, not browser-wide font parsing.
- Image drafts default to session memory. The opt-in checkbox allows refresh recovery for up to 24 hours, with clear controls and visible commit/error states. Expired retained drafts are discarded on access; browser-closed physical deletion cannot be guaranteed. Serialized saves/deletes prevent an older save from resurrecting a cleared draft. ArrayBuffer persistence handles the tested WebKit environment's Blob/File IndexedDB write failure.
- Image converter now revokes source/export object URLs, destroys old PDF documents, guards asynchronous replacements/page renders/exports, bounds files/output dimensions and surfaces decode/export failures. Its unrelated conversion formats and routes remain available.

## Licensing and model selection

See `THIRD_PARTY_NOTICES.md`, `inference-dependencies.json`, `studio-fonts.json` and accompanying public licence texts. Added runtime dependency: **colorjs.io 0.6.1 (MIT, no runtime transitive dependencies)**. Existing ONNX Runtime Web **1.27.0 (MIT)** is retained. No AGPL/GPL, BRIA, restricted model or paid service was added. Fonts use their individual OFL-1.1 licences.

Validated small default checkpoints remain:

- U2NETP from rembg release v0.0.0, independently downloaded and hash-matched.
- MODNet, exact `Xenova/modnet@fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model.onnx`, independently matched against upstream artifact SHA-256.

BiRefNet Lite `onnx-community/BiRefNet_lite-ONNX@de15b22ba131738a16dff04aab8bdf8dc32e3ac1` was downloaded, hash-verified, graph-checked and tested separately. On this M2 adapter, both default and explicitly requested maximum WebGPU limits fail: a shader requires 11 storage buffers and the hardware/browser exposes 10. Its 224 MB FP32 artifact is not shipped or offered as a working option. The original headless-shell probe also lost its browser while transferring the large model; no usable WASM result was established. Full logs and exact candidate metadata are retained. General/portrait BiRefNet candidates were researched, not integrated. The separately validated 512 export and loopback helper are described in the follow-up below.

## Measured evidence

Host: Apple M2, 8 GiB RAM, macOS arm64. Chromium 145.0.7632.6. Exact raw samples, image/input sizes, stage timings and cold/warm labels are in `benchmarks.json`, `backend-results.json`, `browser-results.json` and logs. Model/runtime/network assets were served from localhost; these are **not Internet download benchmarks or mobile latency promises**.

| Experiment | Before | After | Interpretation |
| --- | ---: | ---: | --- |
| 700×350 rotated-dot preview render, 7 samples | 1.1 ms median / 2.7 ms slowest | 3.7 ms / 6.1 ms | Correct area sampling costs more CPU; production rendering is off-thread. This comparison measures renderer work, not worker startup or end-to-end UI delay. |
| U2NETP WASM on 700×450 synthetic product, 5 samples | 1017.1 ms median / 1072.8 ms slowest | 1022.1 ms / 1042.6 ms | Same checkpoint and 320² shape; preprocessing corrected. Small timing difference is not a general speed claim. |
| MODNet WASM on 384×512 NASA portrait crop, 5 samples | 848.5 ms median / 858.8 ms slowest | 641.6 ms / 644.9 ms | Aspect-preserving 384×512 input replaces square 512² work. |
| Current U2NETP WebGPU | First inference 693.4 ms | Warm 86.4 / 79.0 ms | Separate backend experiment, compared with WASM 1013.3 / 1009.5 ms warm. |
| Current MODNet WebGPU | First inference 625.3 ms | Warm 80.9 / 77.4 ms | Compared with WASM 640.7 / 641.7 ms warm. |

WebGPU/WASM maximum output differences on this fixture: U2NETP 0.00003735 and MODNet 0.00026489; mean differences are recorded separately. These are numeric agreement checks, not mask-quality scores. Small sample counts, a single machine and fixed test order limit performance conclusions. Reproduce before setting a device-wide latency budget.

Before/after PNGs for the synthetic product, NASA portrait and halftone ramp accompany this report. Portrait outputs still show halos around light hair/background areas. The product example still exposes a missed background region inside its hole. Correct preprocessing and lifecycle fixes do not turn these small checkpoints into high-quality general matting models. No blur or unvalidated decontamination filter was substituted to conceal these errors.

## Test results and reproducibility

Baseline: 15 frontend test files / 195 tests pass; production build passes with existing large-chunk warnings. Standalone palette suite fails. Repository typecheck has 16 pre-existing diagnostics, including background-removal ArrayBuffer typing and PalettePage effect cleanup.

Historical 4 November result: 21 test files / 217 tests pass, including all 130 standalone palette assertions. Production build passes. Typecheck has 13 remaining pre-existing diagnostics (down from 16); no new diagnostic category was introduced. Chromium 145.0.7632.6, Firefox 146.0.1 and WebKit 26.0 passed core workflows, render/storage/reset edge checks and actual CPU WASM inference. Full Chromium also passed worker WebGPU workflows. See `browser-results.json`, `browser-gpu-results.json`, `edge-results.json` and `brush-results.json`. Chromium exported a real 4000×4000 PNG in 422 ms in the recorded single boundary run; this includes worker work and output bitmap decode, not a repeated median benchmark. At that point repository-wide typecheck still had errors in HeroFlipCards, AppDataContext/AdminPage, legacy grid helpers in DesignStudioPage and an imported displacement-map utility. Baseline and final diagnostics are preserved; The follow-up fixes all 13 rather than dismissing them as harmless.

Commands:

```sh
npm test
npm run typecheck
npm run build
# Browser tooling is intentionally outside the production dependency graph:
STUDIO_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/studio-browser-checks.mjs
STUDIO_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/studio-benchmark.mjs
# Backend comparisons require a Chromium executable with a real GPU adapter:
STUDIO_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs STUDIO_CHROMIUM_EXECUTABLE=/path/to/chrome node scripts/studio-backend-check.mjs
```

Fixtures: original CC0 synthetic ramps, transparent soft-alpha image, holes/thin-structure product and illustrated fine edges; NASA public-domain astronaut photograph; corrupt-file fixture. See fixture provenance. No photographic fur collection or reference-alpha benchmark was fabricated. No reliable semantic reference masks are supplied, so IoU/matting accuracy scores are not reported.

Remaining validation limits: production Safari/iOS/Android, low-memory phones, long-duration GPU/WASM memory profiling, diverse photographic hair/fur/translucent objects, long-duration 16 MP export stress, font shaping beyond the shown scripts, and real-world Internet cold downloads require further testing. Runtime quality and performance are demonstrated only for the stated fixtures and browsers. No deployment was performed.

## Packaging impact

The functional palette engine bundles to 42,878 bytes minified in the standalone esbuild check; `palette-bundle.json` records that zero APCA modules contribute output. In the production route build, PaletteStudio grows from 40.28 to 76.92 kB uncompressed (12.23 to 26.83 kB gzip) because the verified colour-science foundation replaces handwritten formulas. DesignStudioPage shrinks from 86.69 to 71.75 kB uncompressed (24.61 to 22.71 kB gzip) after replacing the large unverified font catalogue. These are emitted chunk sizes, not a whole-site network measurement. The CPU runtime remains a lazy 13.48 MB WASM asset; WebGPU adds a separately lazy 24.25 MB runtime asset. Five self-hosted font families total about 1.4 MiB; only the selected families load. pnpm and npm lockfiles are synchronized with Color.js and the user’s pre-existing Vercel dependency edits. Existing large-chunk and vtracer URL build warnings remain.

Production preview verification also passed in both CPU WASM and real WebGPU Chromium modes: built worker/runtime URLs, portrait inference, PNG download, source-resolution halftone export, local font loading, palette generation, image conversion and source recovery. See `production-results.json`.

The final shared-palette browser check verifies that a copied recipe matches the displayed colours, invalid seeds report an error, and explanations of locked contrast conflicts survive refresh (`share-results.json`). The existing SVG VTracer worker also passed a production smoke check after the worker build configuration change (`vector-smoke.json`).


## Independent follow-up: 5 November 2026

### Baseline and defects repaired

Fresh baseline independently reproduced 217 tests in 21 files, 13 TypeScript diagnostics, a successful production build and real three-engine browser processing. Browser tests load ONNX and run inference; successful segmentation is not replaced by a mock. Historical baseline logs and current validation logs are retained in `followup/logs/`.

All 13 diagnostics are fixed without exclusions, ts-nocheck or ignore directives. Risks and fixes:

- HeroFlipCards: Motion transform output generic and tuple callback inference; explicit correct generic restores the intended array contract.
- Admin image compression: the library advertises File but can return Blob; a Blob contract allows the actual fallback safely.
- AppDataContext notification callback: interface now follows the real API option parameter, preserving callback behavior.
- Grid dimension helper: a real endpoint/argument mismatch could draw invalid canvas dimensions. The helper now accepts both endpoints, draws perpendicular caps and places the label at the midpoint. Two regression tests check actual horizontal and diagonal geometry.
- Isometric grid: vertex tuples are typed at their definition rather than mis-annotating map callbacks.
- Displacement utility: the unresolved alias is replaced by the correct relative import.

Additional defects fixed: retained-image eviction subtracted the wrong size and could evict extra drafts; queued metadata could change before persistence; failed retention revocation previously reported success even if stored bytes remained. Failure now stays visible and the session copy remains usable. Halftone SVG now uses the same compound rectangle fill as canvas, removing rotated full-coverage seams. Standalone palette test cleanup is synchronous, avoiding leaked temporary bundles.

### Chosen opt-in checkpoint and evidence

**Detail** uses the author-published `studioludens/birefnet-lite-512@962e67969ec6acec9c19fab76acee4f5e22e990c/onnx/model.onnx`: **191,877,254 bytes**, FP32, SHA-256 **1cb0fb360dadd15af77c639085d77a9df67db0c64315560c3de005f676345ac2**, input/output `[1,3,512,512]` / `[1,1,512,512]`, ImageNet normalization, output logits followed by sigmoid. `onnx.checker` passes. This is a separate upstream 512 re-export, not an arbitrary input-size edit to the 1024 graph. Exact model-card, licence and artifact provenance are recorded in `followup/512-provenance.json` and the licence notice.

Seven lawful fixtures include a NASA portrait, CC0 cat fur, product holes/thin structure, disclosed contrast/motion derivatives, synthetic fine structures and existing transparency. Exact hashes, licences and limitations are in `followup/fixtures/provenance.json` and README. Photographic flyaway hair is underrepresented. There are no ground-truth semantic masks or numerical accuracy scores.

Open **output-review.html**: original/current/candidate can be viewed on white, black and teal, with native outputs linked. Detail substantially reduces the broad hair halo on this portrait and better preserves the low-contrast helmet highlight. The fresh full-resolution General product already removes most of the hole; Detail improves some rim/attachment edges. Fur and whisker preservation is mixed. Detail destroys much of the translucent synthetic artwork. These are demonstrated specific improvements, not general superiority. General/Portrait remain defaults; “Keep source transparency (skip AI)” bypasses segmentation for artwork with meaningful source alpha. No mask blur, erosion or threshold is used to hide candidate failures.

Browser Detail requires WebGPU and verifies the exact checkpoint before use. The 192 MB download is disclosed and opt-in. Unsupported adapters fail before download. Initialization/inference failure blocks repeated Detail attempts in that worker and offers the smaller paths; it never launches the large model in WASM. Model sessions, tensors, worker cancellation and original-alpha compositing follow the existing bounded workflow.

### Original 1024 failure and alternatives

The original pinned 224,005,088-byte FP32 export, SHA `5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333`, ORT Web **1.27.0**, WebGPU, `[1,3,1024,1024]`, initializes successfully and fails during **inference**. The adapter supports **10** storage buffers per shader stage; the default requested device has **8**. Requesting the supported maximum still reports `Too many storage buffers in shader. Current: 11, Max is 10`. The diagnostic stops at the first excess, so 11 is not proof of the graph's total demand. It contains Concat nodes with up to 1024 inputs and Split nodes with 32 outputs.

Current official ORT guidance was consulted before setting a device before session creation: https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html and https://onnxruntime.ai/docs/api/js/interfaces/Env.WebGpuFlags.html . No unsupported hardware limit was requested. A bounded-Concat rewrite has bit-exact real ORT micrograph tests (positive/negative axes, up to 1024 inputs), but the full graph still fails on remaining operators, including with graph optimization disabled. It is an abandoned research experiment, not a shipped model fix. See `followup/birefnet-bounded*.json`, `scripts/prepare-birefnet-browser.py` and `scripts/test-bounded-concat.py`. A full 1024 CPU comparison was stopped due cost; no completed CPU quality benchmark is claimed.

The 512 FP16 export (98,484,532 bytes, SHA `eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516`) runs on the tested GPU, but fails ONNX graph checking because `graph_input_cast_0` is not topologically sorted. It was not selected; a successful portrait does not prove precision preserves hair. The checked FP32 512 graph avoids the giant Concat/Split topology. Other upstream general/portrait models and rembg were researched; no unmeasured replacement or wrapper licence was treated as proof of weight suitability.

### Optional local Python provider

`services/studio-helper/README.md` contains exact setup and reproduction commands. The actual live service uses the same pinned FP32 512 checkpoint and ORT Python 1.24.2 CPU, warm session, loopback binding, strict Host/Origin, one active plus one queued request, 25 MiB body and 2560px edge limits. A child process supports cancellation/restart, a 45-second inference deadline and a sampled 2 GiB RSS recovery guard. Sampling can miss transient overshoot; this is not a kernel memory hard cap. No image/request logging or upload disk storage is performed.

The UI defaults to browser on every mount. Health checks must verify the protocol, ready checkpoint and SHA before enabling helper selection. Check/select do not send images; only the explicit Remove action posts to `127.0.0.1:8935`. The unavailable helper leaves browser General/Portrait functional. Live tests exposed and fixed repeated CPU memory growth with the arena disabled; the enabled arena passed real cancellation, queue admission, recovery and three repeated masks. Stopping the service releases its model memory.

### Measurements and practical limits

Actual host: **Apple M2, 8 GiB**, macOS arm64. A draft 512 probe incorrectly divided bytes by 512 cubed and printed 64; this unit bug is corrected to 1024 cubed, independently confirmed with sanitized system_profiler hardware data. No device serial/UUID is recorded. No exact GPU allocation peak is claimed.

`followup/birefnet-512-fp32.json`: localhost model transfer 1,339 ms (not an Internet download benchmark); session initialization 1,716.5 ms; first inference 3,198.4 ms; warm inferences 6,463 / 2,305.5 ms (only two warm samples, median 4,384.25 ms, slow 6,463 ms). `followup/candidate-512-cpu.json` contains three runs for each fixture, separate preprocessing/inference/postprocessing/export and per-fixture medians/slow cases; this initial feasibility run had other investigation activity and is not a controlled speed comparison. Sampled process peak was about 1.83 GiB.

`followup/helper-runs.json`: after cancellation/recovery, three real CPU inferences 2,183.193 / 1,826.727 / 1,767.698 ms; median 1,826.727 ms, slow 2,183.193 ms. Sampled child peak 2,042,249,216 bytes (~1.90 GiB); the parent/browser are additional. Health records cold session initialization separately. These figures are resource-sensitive local results, not phone latency promises. `followup/detail-browser.json` records the complete real HF download/UI export and processor phase transitions. Its first processor call initializes a separate worker; it must not be counted as warm. Later diagnostic UI timing runs overlapped builds/browser work and include severe slow cases; they are not controlled performance medians.

### Verification status

Current standard suite: **222 tests / 24 files pass**. **Typecheck clean**. **Production build passes**, retaining existing large-chunk and vtracer URL warnings. Three-engine workflow evidence includes real helper inference and PNG export, explicit no-upload boundaries, source-alpha bypass, bounded FontFace registration after repeated pairing changes, missing-font/offline errors and retry recovery. Independent actual SVG rasterization versus PNG covers black fields, ramps, portraits, fine texture and transparency for squares/lines/dots. Cross-engine endpoint and raster-difference assertions supplement the existing meaningful geometric/tonal tests. Engine results and raw logs are in `followup/`.

Palette standard tests retain harmony/reproducibility, saturated/neutral/black/white seeds, lock repairs, invalid input and impossible constraint checks. Fonts retain the small verified catalogue and actual weight/script metadata. Neither aesthetic palette quality nor numerical font pairing quality is claimed. Existing broad browser suites cover draft switching/refresh, opt-in retention/clear, reset during inference, stale result rejection, storage-denial fallback, actual processing and full-resolution export.

No physical phone, native Safari app, iPhone GPU, broad photographic flyaway dataset, GPU peak-memory counter or long-duration soak test was validated. Playwright WebKit is engine-level coverage only. The model remains large and can be slow under memory pressure. No deployment, cloud provisioning, paid service or public endpoint was performed. Unrelated working-tree changes are preserved.

Final built-site run (`followup/production-results.json`): Chromium 145.0.7632.6 used WASM, Firefox 146.0.1 used WebGPU, WebKit 26.0 used WASM, as reported by the actual worker. Real inference/export and all four remaining tool workflows passed. Palette sharing/invalid input/locked contrast persistence passed (`share-results.json`). Source-alpha bypass exports match original alpha byte-for-byte in all three engines (`followup/source-alpha-check.json`). Final PNG/SVG mean absolute channel differences were ≤0.203 out of 255 across the reviewed fixtures. Live helper tests passed again after all browser workflows; the helper was then stopped to release memory.
