# Actual pinned task classifier engine QA

Status: PROGRESS, not Social content filtering acceptance.
Parent source: 44534564ccbc4793e65c217db28cef02ee57c69d.
Owner branch: codex/social-wallet-chooser-20261001.

## Exact bytes and executed engine

Publisher repository OwenElliott/image-safety-classifier-xs, immutable revision
54f4560bd9c5ee92d45dc30418a8f8680e80de6d, path
onnx/image-safety-classifier-xs.onnx. Actual downloaded bytes: 13137569.
SHA256: 8c28c49d9075f3ad15ebdc2961f02d5b3f99be944815b848b49c9f0e6f3fb689.
Publisher LFS byte/SHA metadata and local readback agree. Local write-protected
content-addressed cache only; weights are NOT committed or release-admitted.

Actual onnxruntime-web 1.30.0 WASM, one thread, proxy disabled. Existing isolated
runtime package and WASM/module hashes are checked before loading. Existing
product package and lock files are unchanged. Raw RGB 0..255 float32 tensor
[1,3,224,224], normalization and softmax belong to the publisher graph.

Actual model input image, one output float32 [1,3]; label order NSFL, NSFW, SFW.
Three synthetic solid RGB cases yield finite [0,1] probabilities summing to 1.
Load: 170.379ms; runs: 50.689 / 35.714 / 34.193ms. No private image was used.
These are engineering input cases, NOT a classification accuracy dataset.
Intercepted global fetch attempts during execution: 0. This does not establish
OS-wide network isolation or private-image browser/native containment.

Initial transfer timed out at 647227 bytes; strict loading rejected size before
session creation (original assertion retained). First bounded continuation timed
out at 8283107 bytes. Second continuation completed; only exact verified bytes
were promoted from .part. No partial model was used for successful inference.

## Primary-source interpretation and outstanding gates

Publisher card declares MIT and three labels: gore-related NSFL, sexual-content
NSFW, ordinary SFW. The pinned config records Apache-2.0 for the SwiftFormer
backbone. Preserve derivative notices; legal redistribution is NOT accepted by
this engineering record. The card warns of subjective errors and scarce NSFL
examples. Author metrics are not independent Social calibration.

Primary sources:
https://huggingface.co/OwenElliott/image-safety-classifier-xs
https://huggingface.co/OwenElliott/image-safety-classifier-xs/blob/54f4560bd9c5ee92d45dc30418a8f8680e80de6d/config.json
https://huggingface.co/api/models/OwenElliott/image-safety-classifier-xs/tree/54f4560bd9c5ee92d45dc30418a8f8680e80de6d/onnx

This candidate has NO separate explicit-violence head. QA reports null, NOT zero
or the same score copied from gore. It cannot satisfy the three-class classifier
port. Do not activate a partial classifier or invent thresholds.

Complementary violence candidate jaranohaal/vit-base-violence-detection, revision
31931091dfd4ea08a30c42be0db8e1488263cbd5, declares two labels but has no semantic
id2label/label2id mapping in its actual pinned upstream config. The converter
revision c04818da5a78f241275f7b58184b24e2f15e3265 also does not prove label order.
No violence weights downloaded, no guessed index or duplicated gore mapping.
Source: https://huggingface.co/jaranohaal/vit-base-violence-detection

Still required: verifiable complementary head and mapping; independent contextual
calibration including benign medical/art/sport examples; signed model/calibration
admission and notices; bounded worker/native inference and lifecycle; explicit
three-category default-off settings and actual product display mount; actual
mobile/platform tests and user/MONSTER acceptance. Existing source/runtime/release
and identity gates remain distinct. MONSTER NOT_RUN. No account request, signing,
transaction, private content upload or deployment.
