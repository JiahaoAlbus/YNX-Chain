# Actual viewer browser rendering - bounded fixture evidence

Executed in Codex IAB tab11 at http://127.0.0.1:54855/ with actual
NativeMatrixMediaViewer, nativeMediaPresentation and MatrixMediaPreview sources
bound byte-for-byte in source-status.json. React/ReactDOM19.2.3 and React Native
Web0.21.2 installed from npm in an isolated temporary prefix (ignore-scripts),
without touching product dependencies/lock files. Esbuild bundles product modules.

Public original YNX Logo only. Explicitly labeled fixture page and port, no real
Matrix/backend authorization, account, Wallet request, private file or deployment.
Original MatrixMediaPreview validates a file:// fixture lease; a QA-only subclass
maps its already validated public-logo URI to local HTTP for browser rendering.
This is NOT native filesystem download/rendering proof or canonical authorization.

Five actual browser cases via visible controls: normal opens actual Image with
public logo; change original event; explicit port rejection; retry restores Image;
close removes Image and releases original fixture lease. Parent useLayoutEffect
records commit DOM before child's passive useEffect cleanup. On transition to
$second it records layoutImagePresent=false and layoutImageHTML=null. The previous
normal DOM contains Original received image; failed-open DOM contains the actual
error and no image; recovered DOM contains Image; closed DOM contains no image.
All operations in one tab and stable URL. Captured top-frame warn/error logs=[]
is bounded to this fixture, not a whole-product production console0 claim.

Screenshots: normal/rejected/recovered. DOM-backed cases and scope records in
browser-proof.json. Browser tab closed. Dedicated fixture server stopped after
capture; no existing service interrupted. Exact source hashes/bundle hash and
runtime versions in source-status.json.

Product source and test changes remain uncommitted: full typecheck still has the
new test-only TS2540 readonly-uri error; fixture repair question is pending human
choice. 303 actual tests and Android+iOS JS exports previously passed. Browser
execution does not override that compiler failure or prove native install/public
whole-product acceptance. Real private Matrix, historical node continuity,
model admission/context calibration, installed/public whole Social and genuine
dot/MONSTER ordinary-user execution remain NOT_VERIFIED/NOT_RUN. No release lease.
