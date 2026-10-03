# Real local vision graph engineering checkpoint

Not a production classifier, local protection, Android/browser benchmark or Social acceptance.

The original locked Social dependencies contained no ONNX/Transformers runtime. A single bounded official registry query returned onnxruntime-web@1.30.0 and sha512 integrity q0y+JrrtukXSzsBWEMccVfqX25LRmosXHF+CaRJmg8pZClzcV7svNc4rKY3jL02Vb7QmRMDs1SigqR4CXAfKYQ==. The initial shell wrapper exited with zsh readonly-variable status after writing the registry output; the registry query was not repeated. A separate actual isolated npm installation succeeded (18 packages, 11s), exact version, install scripts disabled, no product/shared package or lock changes. Its lock is retained here. Runtime package declares MIT.

The publisher-pinned SigLIP2 vision-only Q4 bytes were actually downloaded once from:
https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX/resolve/ba1f3b0843f24bc5417d38e19c37b287d719b2f4/onnx/vision_model_q4.onnx

63,267,466 bytes; actual SHA256 verified 03e61be280fb24114facd87a1e1e6b2b654aad49845686da2f930c72740914aa. The conversion publisher points to Google's SigLIP2 base model; upstream model card declares Apache-2.0 and generic zero-shot image classification, not validated safety classification. These are provenance observations, not legal/safety acceptance. No terms acceptance or account login performed.
https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX
https://huggingface.co/google/siglip2-base-patch16-224

The original actual bytes are preserved under this owner-controlled model-cache/sha256/<digest>/vision_model_q4.onnx, write-protected, deliberately not committed to Git. This is a local content-addressed engineering cache, not a remotely admitted model carrier or immutable release. The verifier script checks exact size/hash again before every run. Runtime remains reproducible from the retained exact npm lock; its installed copy is temporary.

Actual scripts/local-vision-inference-qa.mjs executed with the local model, wasm CPU and one thread. Only a synthetic zero tensor [1,3,224,224] was processed; no private/user image, private message, classification prompt, signing or request grant.

Actual result: load 234.433 ms; first/second inference 793.534/779.988 ms. Both return finite last_hidden_state [1,196,768] and pooler_output [1,768]. Session released. process RSS measured after runs 463,306,752 bytes (not peak, not smartphone budget). Global fetch intercepted after asset acquisition, attempts zero. This does NOT establish OS-level network isolation or absence of every possible networking API. No cloud-fallback claim.

Next: a complete permitted reviewed classifier plus measured per-class/context calibration and a real device isolation/worker/resource path, not treating these embeddings as safety scores. Required three-category accuracy, model update trust, browser/native product mount, no-flash previews/notifications/search, single-view/feedback and installed/public acceptance remain NOT_VERIFIED. The two separately reported TS type fixes remain awaiting human choice; this JS QA result does not override their compilation failure. No full candidate build or deployment promoted. MONSTER NOT_RUN.

Reproduce in the isolated runtime stage, or reconstruct that stage from runtime-package-lock.json:
node apps/social/scripts/local-vision-inference-qa.mjs /tmp/social-local-inference-20261003.GczIkz apps/social/evidence/local-inference-preflight-20261003/model-cache/sha256/03e61be280fb24114facd87a1e1e6b2b654aad49845686da2f930c72740914aa/vision_model_q4.onnx

Primary runtime deployment guidance reviewed: https://onnxruntime.ai/docs/tutorials/web/deploy.html . Runtime JS, WASM and model closure are separate assets; do not rely on a package name alone.
