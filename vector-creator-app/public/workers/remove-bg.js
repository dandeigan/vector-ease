// Background removal worker (module worker). Runs the ISNet model (DIS,
// Apache-2.0) in the browser with ONNX Runtime Web, off the main thread so the
// page stays responsive. Images never leave the user's computer.
//
// In:  { id, rgba: Uint8ClampedArray (1024x1024x4) }
// Out: { id, mask: Uint8ClampedArray (1024x1024, 0 = background, 255 = subject) }
//      { id, progress: string }  while loading
//      { id, error: string }

const ORT_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/ort.wasm.min.mjs";
const MODEL_URL = "https://huggingface.co/onnx-community/ISNet-ONNX/resolve/main/onnx/model_quantized.onnx";
const CACHE = "vectorease-models-v1";
const SIZE = 1024;

let sessionPromise = null;

async function fetchModel(report) {
  let cache = null;
  try { cache = await caches.open(CACHE); } catch { /* private mode: no cache */ }
  const hit = cache && (await cache.match(MODEL_URL));
  if (hit) return new Uint8Array(await hit.arrayBuffer());

  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error("Couldn't download the background model. Check your connection and try again.");
  const total = Number(res.headers.get("content-length")) || 44_000_000;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0, lastPct = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    const pct = Math.min(99, Math.floor((got / total) * 100));
    if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; report(`Downloading the AI model, one time only (${pct}%)`); }
  }
  const bytes = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { bytes.set(c, o); o += c.length; }
  if (cache) cache.put(MODEL_URL, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } })).catch(() => {});
  return bytes;
}

function getSession(report) {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await import(ORT_URL);
      ort.env.wasm.wasmPaths = ORT_URL.slice(0, ORT_URL.lastIndexOf("/") + 1);
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      const model = await fetchModel(report);
      report("Starting the AI model...");
      const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      return { ort, session };
    })();
    sessionPromise.catch(() => { sessionPromise = null; });
  }
  return sessionPromise;
}

self.onmessage = async (e) => {
  const { id, rgba } = e.data;
  const report = (progress) => self.postMessage({ id, progress });
  try {
    const { ort, session } = await getSession(report);
    report("Finding the subject...");
    // ISNet input: RGB planes, (value - 128) / 256.
    const n = SIZE * SIZE;
    const input = new Float32Array(3 * n);
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      input[p] = (rgba[i] - 128) / 256;
      input[n + p] = (rgba[i + 1] - 128) / 256;
      input[2 * n + p] = (rgba[i + 2] - 128) / 256;
    }
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) });
    const data = out[session.outputNames[0]].data;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) { const v = data[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    const range = mx - mn || 1;
    const mask = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) mask[i] = ((data[i] - mn) / range) * 255;
    self.postMessage({ id, mask }, [mask.buffer]);
  } catch (err) {
    self.postMessage({ id, error: (err && err.message) || "Background removal failed." });
  }
};
