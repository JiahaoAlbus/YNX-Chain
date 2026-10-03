# Real browser Worker checkpoint

Source: 0d02191f1cc51367e9fc8a30f8050f27e8152203
Tree: dbced899e0371fdd40d1ab32ef7ed3b968ce615d
Parent: fc06fcc3a43d0daa28ca90e8ebf9732d7dbc19e1

Status: REAL_LOCAL_BROWSER_WORKER_ENGINEERING_ONLY. No production classifier, installed/public Social or MONSTER acceptance.

Actually opened the owner QA page in the real in-app browser and used ordinary Run/Cancel controls, not injected model results or fake providers. The page explicitly identifies itself as engineering QA, not the Social app. Only the original SHA-pinned model and WASM, synthetic zero tensor and original logo were used. Runtime package is the exact isolated onnxruntime-web@1.30.0 from the preceding checkpoint.

Worker response headers actually captured: default-src none, script-src self with wasm-unsafe-eval, connect-src none, worker-src none; COOP same-origin/COEP require-corp/CORP same-origin. Model and runtime bytes are checked on every serve. Parent transfers the validated model/WASM bytes, avoiding model/WASM network requests from the restricted Worker. Only same-origin reviewed runtime module imports remain permitted. A worker fetch probe was actually rejected and the server's probe count stayed zero. This tests this browser Worker connection policy, not all egress primitives or OS/process isolation and not the entire product.

Actual outcomes:
- Normal: real two-run WASM graph, finite original dimensions [1,196,768] and [1,768], session released. Load 199.865ms, runs 775.235/742.930ms.
- Cancel during initial asset preparation: canceled status, Run enabled, no result retained.
- Cancel after the UI entered the Worker-created stage: Worker terminated, no result retained. This does not identify an exact CPU instruction or prove cancel latency on Android.
- Normal button recovery after cancellation: real graph success, load 85.390ms, runs 793.260/761.565ms, rejected probe/server count zero.
- Separate deliberately invalid public model fixture: strict artifact hash refused serving the model; actual UI says nothing was classified and Retry remains available. Original 63MB model untouched.
- Return to original valid QA service and run again: real graph success, load 175.675ms, runs 760.991/746.105ms. This is recovery between dedicated QA endpoints, not a production node migration or same-origin deployment upgrade.

Screenshots/browser proof retained. Positive and negative servers were the calling task's own handles 33552 and 73387; both explicitly interrupted and returned exit0 after completion. Browser tab closed. No other service, user tab, account, keys or data was stopped/modified. No sensitive Wallet action or deployment occurred.

All results remain visual embeddings, not gore/explicit violence/sexual content scores or measured classifier accuracy. No image preprocessing, model update key, full classifier calibration, ordinary messages/media/notifications/search mount, device/platform capacity, installed/public release or real user flow is accepted by this QA. Top-level dev logs are not an audit of all worker diagnostics. The two separately reported TS compiler errors remain unresolved pending human choice; four uncommitted filter source files are excluded from both commits and no full compilable product is claimed. MONSTER NOT_RUN.

Reproduce with the exact isolated npm lock/model cache from local-inference-preflight-20261003, then open the logged local URL and use buttons:
node apps/social/scripts/local-inference-worker-qa/server.mjs /tmp/social-local-inference-20261003.GczIkz apps/social/evidence/local-inference-preflight-20261003/model-cache/sha256/03e61be280fb24114facd87a1e1e6b2b654aad49845686da2f930c72740914aa/vision_model_q4.onnx

Primary API checked: https://onnxruntime.ai/docs/api/js/interfaces/Env.WebAssemblyFlags.html . wasmBinary allows the separately verified binary buffer; numThreads=1 avoids a nested thread worker. No runtime flags are a substitute for actual classifier/privacy acceptance.
