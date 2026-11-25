# Design Studio third-party notices

This file covers dependencies and assets introduced or explicitly selected for the Design Studio improvements. It is not a legal clearance of every pre-existing site dependency. Software/model licences do not guarantee rights in training data, depicted people, trademarks, or third-party material.

## Colour science

**colorjs.io 0.6.1**, MIT, copyright © 2021 Lea Verou and Chris Lilley. Source: https://github.com/color-js/color.js/tree/v0.6.1 . Full licence: [public/licenses/colorjs.io-0.6.1-MIT.txt](public/licenses/colorjs.io-0.6.1-MIT.txt). This release has no runtime dependencies. Selected over adding overlapping Culori APIs; conversions, sRGB gamut mapping, WCAG 2.1 contrast and CIEDE2000 delegate to this library. APCA is not exposed or scored in the product.

## Local inference runtime and existing model artifacts

**onnxruntime-web 1.27.0**, MIT, Microsoft; existing dependency retained. Source: https://github.com/microsoft/onnxruntime/tree/v1.27.0 . The npm runtime depends on onnxruntime-common (MIT), flatbuffers (Apache-2.0), guid-typescript (ISC), long (Apache-2.0), platform (MIT) and protobufjs (BSD-3-Clause). Exact installed relevant dependency versions/licences are recorded in `docs/studio-validation/inference-dependencies.json`; original package notices are preserved. See `public/licenses` for runtime/model licence texts.

- **U2NETP**: existing `public/models/u2netp.v1.onnx`, SHA-256 `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`. An independent download from https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx matched byte-for-byte by SHA-256. Static FP32 NCHW 1×3×320×320, opset 11, sigmoid saliency output. Model/code source: https://github.com/xuebinqin/U-2-Net (Apache-2.0); ONNX release source: https://github.com/danielgatis/rembg (MIT wrapper; separate upstream model licence applies). Upstream training checkpoint identifier is U2NETP; the release does not record a training commit in this file. Full model licence: `public/licenses/U2NET-Apache-2.0.txt`.
- **MODNet**: existing `public/models/modnet.v1.onnx`, exact match to `Xenova/modnet` revision `fa2fa546052fba4c08921230a26cc69a333fca12`, `onnx/model.onnx`; SHA-256 `07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9`. Source: https://huggingface.co/Xenova/modnet/tree/fa2fa546052fba4c08921230a26cc69a333fca12 . Model card declares Apache-2.0; upstream https://github.com/ZHKKKe/MODNet uses Apache-2.0. FP32 dynamic NCHW graph, opset 11, sigmoid matte; mean/std 0.5 and dimensions divisible by 32. Export provenance is identified; upstream training checkpoint digest is not supplied by the conversion card. Full licence: `public/licenses/MODNet-Apache-2.0.txt`.

Research candidates, **not selected production dependencies**:

- `ZhengPeng7/BiRefNet_lite`, MIT model card; ONNX conversion `onnx-community/BiRefNet_lite-ONNX@de15b22ba131738a16dff04aab8bdf8dc32e3ac1`. FP32 artifact: `onnx/model.onnx`, 224,005,088 bytes, SHA-256 `5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333`. FP16 artifact: 114,538,221 bytes, SHA-256 `d39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402`. 1024² input, ImageNet normalization, output logits require sigmoid. Source https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/tree/de15b22ba131738a16dff04aab8bdf8dc32e3ac1 . Source model and converter cards separately declare MIT. BiRefNet licence retained at `public/licenses/BiRefNet-MIT.txt` for research attribution.
- General BiRefNet conversion `onnx-community/BiRefNet-ONNX@534d3c82d3bb8b2f0867db6dfbc3a525b8e42f67`, MIT card, 972,666,916-byte FP32 / 489,666,272-byte FP16 exports. Portrait upstream `ZhengPeng7/BiRefNet-portrait@b6561965a70070d9143fd9e558f6ca3c481510db`, MIT model card; no selected/validated portrait ONNX export.
- IMG.LY background-removal-js (AGPL) and BRIA RMBG restrictions were not introduced. No rembg Python server, paid endpoint, external image upload, or cloud resources were added.

## Font catalogue

Five families are self-hosted from **google/fonts@f60b457bc90062c17f9bf80a882da25a86f56200**, each under **SIL Open Font License 1.1**. Individual notices and licence texts accompany each family in `public/fonts/studio/*-OFL.txt` and are downloadable in the UI:

- Inter (`ofl/inter`)
- Source Serif 4 (`ofl/sourceserif4`)
- JetBrains Mono (`ofl/jetbrainsmono`)
- Noto Sans Devanagari (`ofl/notosansdevanagari`)
- Noto Serif Devanagari (`ofl/notoserifdevanagari`)

Exact source URLs, upstream TTF hashes, generated WOFF2 hashes, supported weight axes and OS/2 metrics: `src/app/lib/studio-fonts.json`. These are unmodified font outlines, converted to WOFF2 using fontTools; licences and reserved-name notices are retained. Conversion and preparation script: `scripts/prepare-studio-fonts.py`. Scripts were checked from cmap metadata for the advertised Latin/Devanagari selection; this is not a promise of coverage for all Unicode or shaping engines. No fonts are sold separately. Recipe export links to the applicable font files and licences.

Fontsource, fontkit and opentype.js were researched; none were added. Numerical typographic quality scores were removed instead of treating font metrics as aesthetic proof.

## Renderer and fixtures

The replacement halftone renderer is original project code. glsl-halftone, Pixi filters and halftone-dithering-fx were researched for architecture; no code, shaders, assets or dependencies were copied from them.

Synthetic fixtures are original and dedicated under CC0-1.0 by `scripts/generate-studio-fixtures.py`. `astronaut.png` is NASA's Eileen Collins public-domain photograph, distributed by scikit-image v0.25.2. Source: https://raw.githubusercontent.com/scikit-image/scikit-image/v0.25.2/skimage/data/astronaut.png ; provenance/public-domain statement: https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut . Subject likeness and endorsement rights are not inferred. No reference semantic mask is supplied for this photograph.

Browser QA uses Playwright 1.58.2 (Apache-2.0), installed in an external temporary test environment, not as a production dependency.

## Follow-up: opt-in Detail model and loopback CPU provider

The browser and optional Python provider select **studioludens/birefnet-lite-512**, revision **962e67969ec6acec9c19fab76acee4f5e22e990c**, `onnx/model.onnx`, 191,877,254 bytes, SHA-256 `1cb0fb360dadd15af77c639085d77a9df67db0c64315560c3de005f676345ac2`. Exact pinned source: https://huggingface.co/studioludens/birefnet-lite-512/tree/962e67969ec6acec9c19fab76acee4f5e22e990c . Its separately checked licence is MIT, Copyright 2024 ZhengPeng and 2026 Studio Ludens V.O.F.; complete notice: `public/licenses/studioludens-birefnet-lite-512-MIT.txt`. Upstream BiRefNet is MIT; the converter identifies upstream Lite but does not supply a base training-weight digest. This limits training provenance, not the exact downloaded conversion hash. The FP32 static 512 input is the converter's declared export. The same-revision FP16 artifact was investigated but not selected: SHA `eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516`, 98,484,532 bytes, same MIT notice; its graph-check failure is documented.

The separate optional local service is original project code, not a rembg package installation. Its pinned runtime dependencies are ONNX Runtime **1.24.2** (MIT), NumPy **2.2.6** (BSD-3-Clause and bundled dependency notices), Pillow **12.1.1** (MIT-CMU), psutil **7.2.2** (BSD-3-Clause), flatbuffers **25.12.19** (Apache-2.0), packaging **26.3** (Apache-2.0 OR BSD-2-Clause), protobuf **7.36.2** (BSD-3-Clause), SymPy **1.14.0** (BSD-3-Clause) and mpmath **1.3.0** (BSD-3-Clause). Installed wheel metadata and full runtime closure: `docs/studio-validation/followup/helper-dependencies.json` and `services/studio-helper/requirements-lock.txt`. Exact licence files, including ONNX Runtime third-party notices and bundled NumPy notices, are retained under `public/licenses`. ONNX **1.20.1** (Apache-2.0) is only an external graph-check/research dependency, not part of the service runtime. Python 3.13.14 uses the PSF licence. No GPL/AGPL, non-commercial, IMG.LY or BRIA dependency was added.

Additional fixture **Chelsea** (scikit-image v0.25.2) is CC0-1.0, Stefan van der Walt: https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.chelsea . Exact file and SHA are in `docs/studio-validation/followup/fixtures/provenance.json`. Contrast/motion fixtures are disclosed derivatives of the NASA public-domain astronaut, and synthetic fine-edge/product/translucent fixtures retain original-project CC0 attribution. No fabricated reference masks are distributed.

The earlier statement that no Python provider was added describes the historical implementation; this follow-up adds only an explicitly selected, tested loopback provider. No cloud or public inference endpoint is deployed.
