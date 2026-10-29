# Expected control behavior and verification map

Evidence levels: **native** means exercised in Safari through its actual UI; **DOM** means a rendered React interaction test; **unit** means an executable domain/boundary contract; **trace** means the reachable handler and consumer were inspected. This inventory does not claim every settings cross-product was exercised in a browser.

| Surface / visible controls | Expected behavior | Evidence |
|---|---|---|
| Shell: eight tool buttons | Query selects one lazy tool; prior heavy work unmounts; heading receives focus | native, trace |
| Direct URL, refresh, Back/Forward | Select the named tool and preserve navigable history | native |
| Return-to-tool draft note | Palette/font/contrast drafts remain in this tab; media input clears on leave | DOM, native, trace |
| Palette seed picker/hex, harmony selector, Generate, random seed | Valid complete committed input controls deterministic harmony; bad draft leaves output intact and reports error | unit, DOM, native |
| Palette Light/Dark and Compare themes | Select coherent variants; compare uses both committed variants | unit, DOM, native |
| Palette 18 role colour editors, lock/unlock and clear locks | Edit final value; locked bytes survive future generations and both variants; unlock resumes generation | unit, DOM; native lock/theme checks |
| Palette swatch/hex copy, CSS copy/download | Copy only reports success after clipboard write; download exports 18 roles per theme with seed/harmony identity | DOM, unit, native download |
| Palette Palette/Accessibility/Colour vision/Mood views | Analysis references final values; pair thresholds are raw; models and heuristics are labelled | unit, DOM, native panels, trace |
| Palette mood profiles/reroll/JSON and colour-association details | Five independent moods remain separate from semantic tokens; association text is editorial | unit, DOM, trace |
| Font strategy filters, regenerate, previous/next, history dots | Filter finite catalogue; branch bounded history; selected strategy/pair is exposed accessibly | DOM, native history, trace |
| Font sample text and 24–96px size | Preview uses current sample and actual slider size | native 96px; trace |
| Font specimen links | Open the displayed family reference; both role weights are requested, unioned for one family | unit/DOM, trace; initial actual fonts loaded natively |
| Font load status | Report actual loaded faces or visible fallback/slow/error state | native success, DOM failure, trace |
| Contrast pickers/hex and Swap | Last valid pair supplies ratio; incomplete draft is marked and disables ambiguous swap | unit, DOM, native, trace |
| Contrast threshold cards and suggestions/Apply | Use unrounded pair-specific thresholds; suggestions pass the stated target and preserve nearest eligible lightness policy | unit/shared engine, trace, native display |
| Image/PDF choose/drop, format, quality, scale | Decode bounded supported browser image types/PDF; JPEG flattens alpha; changed settings hide stale download | DOM, unit, native PNG/PDF/JPEG workflow, trace |
| Image/PDF previous/next page, Convert | Render the selected page; stale loading/render/encoding cannot publish after reset | native two pages, DOM cancellation, trace |
| Image/PDF Download, Clear/Cancel | Download actual MIME extension; clear cancels work and removes source/result | native keyboard upload/convert/download/clear, DOM, trace |
| Grid format, orientation, custom dimensions | Use validated dimensions; swap rendered shape and label actual orientation | unit, DOM, native Custom geometry, trace |
| Grid nine systems and parameter sliders | Draw only feasible geometry; displayed measurements match chosen system | unit, native representative systems, trace |
| Grid recents, restore, Clear | Validate persisted snapshots; debounce completed edits; Clear cannot re-add a queued snapshot | unit/DOM fake-timer regression, trace |
| Halftone browse/drop/replace/clear, reset | Input ownership changes safely; reset settings retains the source; clear removes it | native, trace |
| Halftone Lines/Dots/Squares and adjustments | Relevant settings affect bounded cached rendering; Detail appears only for Lines; alpha samples flatten explicitly | native styles and controls, unit/pure logic, trace |
| Halftone PNG | Export current working dimensions, with ≤700px disclosure | native three exports and file inspection |
| SVG direction, Line/Vector engine | Cancel old work; expose active selection and correct controls | DOM, native, trace |
| SVG image/SVG picker, threshold/fill/invert/thicken | Bounded decode; line settings clear stale output; invalid upload reports error | native upload/line export; unit/DOM security; trace |
| SVG Photo/Line Art/Pixel Art, colour/binary, path style, advanced sliders | Apply retained presets/config; invalidation prevents stale worker result publication | unit/job tests, native vector run, trace |
| SVG raster PNG/JPG, quality, scale, Convert/Download | Use validated SVG image resource; dimensions/MIME match result; settings clear stale output | native PNG/JPG and four-width actions; DOM cleanup/security; trace |
| SVG Reset and tool leave | Invalidate revision, settle worker calls and release source/result/pending raster URLs | unit/DOM, native workflow, trace |
| Background browse/drop/paste, General/Portrait, Remove/Re-run | Validate existing accepted formats/25MB; model/source changes invalidate prior work; progress belongs to current request | native both models, unit ownership/session/cache, trace |
| Background transparent/white/black and PNG | Composite requested backdrop while preserving source alpha; stale export cannot publish after reset/leave | unit alpha/bitmap failure, native PNG/refined export, trace |
| Background Restore/Erase, brush size/soft/hard, Undo/Redo and shortcuts | Update mask/history with bounded 15-state ownership; pointer cancel ends stroke | native erase stroke, undo/redo/buttons/shortcuts; existing pure refinement tests; pointer-cancel handler traced |
| Background Reset / leave | Cancel worker/progress, close bitmap, clear result/history and feedback | unit ownership, native return-to-tool clearing, trace |
| Focus, labels and selection | Native controls remain reachable with Safari Option-Tab/Enter; primary actions ≥44px on narrow screens | native keyboard paths, DOM state regressions, CSS/handler trace |
| Theme / reduced motion | Keep token-based readability and suppress scoped decorative motion when requested | native both themes and page-only Reduce motion=On; DOM homepage card test |

Not separately certified: all screen-reader/browser/device combinations, each pointer-cancel timing interleaving, every PDF document/codec, denial of real browser allocation/cache quotas, and subjective segmentation quality. These are coverage/model limits rather than evidence of a reproduced product failure.
