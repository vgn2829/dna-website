# Optional local Detail provider

Validated on macOS arm64 / Apple M2, Python 3.13.14, ONNX Runtime 1.24.2 CPU. Browser General/Portrait work independently. This helper uses the same verified FP32 512 export as browser Detail; it is not a separate, universally better model. Translucent artwork and some whiskers remain poor cases.

From the repository root:

```sh
python3 -m venv .venv-studio-helper
.venv-studio-helper/bin/python -m pip install -r services/studio-helper/requirements-lock.txt
.venv-studio-helper/bin/python services/studio-helper/download_model.py --output /tmp/dna-birefnet-512.onnx
.venv-studio-helper/bin/python services/studio-helper/server.py --model /tmp/dna-birefnet-512.onnx
```

The download is 191,877,254 bytes. The downloader and service verify SHA-256 `1cb0fb360dadd15af77c639085d77a9df67db0c64315560c3de005f676345ac2`. The model is `studioludens/birefnet-lite-512@962e67969ec6acec9c19fab76acee4f5e22e990c/onnx/model.onnx`, MIT (upstream and conversion notices in `public/licenses`). No rembg package is required.

Open Studio on localhost:5173 (development) or :4173 (preview). Click **Check Python helper**, explicitly choose the Python processing location, then **Remove Background**. Only the final action sends the selected image from the browser to `127.0.0.1:8935`. Processing location is not persisted. Health-check failure leaves the helper option disabled. Stop with Ctrl-C to release the warm model. For another trusted local app origin, pass `--origin http://localhost:PORT`; do not proxy this service onto a public interface.

The service binds only loopback, validates Host and exact Origin, has no request/image logging, and stores uploaded images only in memory. It admits at most two bodies (one inference plus one queued), 25 MiB encoded per image, a 2560px maximum edge, and 6,553,600 pixels. A child process allows cancellation/timeout recovery without leaving inference running. Cancellation restarts an active child's session; cancelling a queued job does not interrupt another job. Inference deadline: 45 seconds; initialization deadline: 60 seconds. RSS is sampled every 25ms against 2 GiB; this is a recovery guard, not a kernel-enforced hard memory reservation. A transient overshoot is possible. The parent and browser also consume memory.

Run the real live-service checks after health reports ready:

```sh
.venv-studio-helper/bin/python services/studio-helper/test_server.py
```

These cover three real repeated inferences, origin/host rejection, corrupt/oversized images, admission limits, cancellation and recovery. `scripts/studio-followup-checks.mjs` also verifies explicit browser selection and PNG export in Chromium, Firefox and WebKit. These are engine tests, not iPhone or native Safari certification.
