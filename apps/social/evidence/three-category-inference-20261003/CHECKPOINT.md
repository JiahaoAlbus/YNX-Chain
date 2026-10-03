# Actual three-category candidate composition

Status: PROGRESS. Not a product release, calibration or filtering acceptance.
Owner branch: codex/social-wallet-chooser-20261001.
Parent: c018fd03b52ac56d171c6c956eced3c2d37c4657.

## Primary-source pairing

Independent violence head: khasinski/siglip2-moderation-heads revision
b88fe03369e3dc6aa9887cd3b4cd3e9b7cf76ee5. The publisher documents a binary
violence logit from a normalized 768-dimensional feature of
Google SigLIP2-base-patch16-256. Apply sigmoid once. The head graph names its
external data file violence_head.onnx.data; its bytes are provided explicitly,
not fetched on inference. Publisher declares Apache-2.0, photographic training
and weaker graphic-illustration recall. Author metrics are not Social accuracy.

Compatible encoder conversion: onnx-community/siglip2-base-patch16-256-ONNX
revision d1114256522a37ffa257a0a58017348ab0058db2. Resize 256x256, rescale 1/255,
mean/std 0.5; L2-normalize the actual pooler_output before the head. Do not use
the old 224 encoder. Conversion provenance links Google base-patch16-256.
Q4 conversion/fp32 equivalence and classifier calibration remain NOT_VERIFIED.

Gore/sexual scores: existing pinned OwenElliott classifier, revision
54f4560bd9c5ee92d45dc30418a8f8680e80de6d, label positions NSFL/NSFW respectively.
No duplicated gore score, no filled-zero violence score, no threshold activation.

Sources:
https://huggingface.co/khasinski/siglip2-moderation-heads
https://huggingface.co/onnx-community/siglip2-base-patch16-256-ONNX
https://huggingface.co/google/siglip2-base-patch16-256
https://huggingface.co/OwenElliott/image-safety-classifier-xs
https://onnxruntime.ai/docs/tutorials/web/large-models.html

## Exact verified local bytes

XS classifier: 13137569 bytes, SHA256
8c28c49d9075f3ad15ebdc2961f02d5b3f99be944815b848b49c9f0e6f3fb689.
256 encoder: 63451786 bytes, SHA256
712064dae0cce3fb4c94497c7dfd65d11f4ad34eadafe09442208474068cf777.
Violence graph: 869 bytes, SHA256
268b8702e8e373ab0fea4de55250f506650ff87be532d1809ba70513bd5fa5b4.
Violence data: 788480 bytes, SHA256
433df42d2b884d598a65f41d1cb16e2c44b60000f0f46da6b7c380f3851ce2ef.
All downloads completed and matched size/SHA before .part promotion; new cache
files are locally read-only. Weights stay untracked; not a remote signed model
carrier or production download manifest. Product packages/locks unchanged.

## Actual executed validation

onnxruntime-web 1.30.0 WASM, single thread, proxy disabled; runtime module/WASM
hashes validated. Actual sessions load all three models and the head data.
Inputs are synthetic gray and the original public YNX logo, then repeat logo.
The logo PNG decoder is the existing pngjs 5.0.0, not a new dependency. Explicit
QA white alpha composite and half-pixel bilinear resize are used; preprocessing
is NOT claimed bit-identical to every Pillow or browser implementation.

Resampling includes opaque/transparent constant-pixel assertions. Actual model
outputs have expected names/shapes, finite values and probability bounds;
normalized embedding norm is checked. Full load 340.515ms. End-to-end runs
approximately 1.11s, 1.13s, 1.08s. Public logo repeated scores agree:
gore 0.0372665413, violence 0.1566049257, sexual_content 0.0406039953.
No assertion claims the model correctly identified safe or unsafe content.
The old 224 encoder is separately rejected at pinned-size validation before
creating model sessions. Original assertion log is retained.

Intercepted global fetch attempts during composition: 0; NOT OS network proof.
No private content, upload, account request, signing, transaction or deployment.

## Required next product gates

This is a single complementary candidate, not an alternate Social app. Three
numerical outputs are present, but real independent medical/art/sport/graphic
calibration is NOT_RUN. Signed bundle/admission and redistribution notices,
bounded isolated worker/native cancellation, actual display/settings mounting,
no-preflash/error/retry validation and platform/user acceptance are incomplete.
The approximately one-second encoder must not be placed on the product UI
thread. Filtering remains default-off; no uncalibrated head is enabled.
Original identity/Matrix/public-installed source binding gates remain distinct.
Dot/MONSTER NOT_RUN. Coordinator: 接续测试网生态审计工作 only.
