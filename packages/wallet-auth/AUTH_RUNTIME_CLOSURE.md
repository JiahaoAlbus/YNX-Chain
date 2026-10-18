# Original Auth runtime closure

This build-time inventory supports the original Native Source release. It is not
an authority issuer, production proof command, Root, permission or Source holder.
It does not execute the inventoried modules, sign, or contact a node.

The original Auth consumer uses one canonical JSON object:

```json
{"files":[{"bytes":123,"path":"src/example.js","sha256":"<64 lowercase hex>"}],"version":"YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1"}
```

The generator sorts object keys and file rows by ASCII path. Every path is relative
to the actual installed wallet-auth package root. The fixed destination is
`native/original-ide-auth-runtime-manifest.json`; that file does not inventory
itself. Node builtins, entry points and resolution observations belong in the
separate build report. They must not add fields to the Native machine schema.

Generate from a normal isolated install with the actual fixed candidate and Noble
packages present. A repository node_modules symlink, tar checksum, companion-only
checksum or test provider declaration cannot substitute for the installed files.
Resolve with the pinned Node runtime and default Node ESM import conditions;
build-time validation requires `--experimental-import-meta-resolve`. The original
Source driver and shared verifier are the initial entry points. Add the original
Auth dispatch entry only after its supplier freezes the exact handoff. A manifest
from the old driver must not be relabeled as the later dispatch closure.

The generator inventories reachable local code and package resolution controls,
and conservatively includes third-party package resources. It refuses symlinks,
nonregular files, resolution outside the package root and unsupported dynamic
module loading. The validator regenerates the inventory and compares the exact
canonical machine object, so omitted, added or modified closure files fail.

The original Native release must independently pin the manifest digest and the
fixed dispatch digest, authenticate the release and trusted installation root,
verify ownership and regular-file status, and hold/recheck the complete file set
before and after the bounded original process. The Node executable, loader flags,
environment, runtime conditions and OS custody remain independently protected
Native release inputs. A JS inventory check cannot provide atomic OS custody.

This inventory creates no admission. Root/Source enrollment, actual current
state, fixed node origin/SPKI/native chain binding, purpose-specific permission,
once/window/once rules, normal peer approval, recovery custody and private effects
remain separate original-owner requirements. Missing requirements remain not ready.

Build API (the module requires the declared TypeScript build dependency):

```js
import {generateAuthRuntimeClosure, validateAuthRuntimeClosure}
  from './scripts/auth-runtime-closure.mjs';
const {manifest, report} = generateAuthRuntimeClosure(absoluteInstalledPackageRoot);
const raw = JSON.stringify(manifest); // already canonical key and row order
validateAuthRuntimeClosure(absoluteInstalledPackageRoot, raw);
```

`options.entries` may explicitly select frozen original module roots. The Native
minimum seven files are an inclusion floor, not a complete dependency list.
The default original driver now includes the frozen R92 dispatch branch. SDK325
verification mathematics and signing code remain the same. Original Native
headers, linked binaries, Source admission and UI transport retain their owners.

CI extracts the exact Git-checked package archive and performs a normal isolated
npm install before generating and validating the inventory. It emits the machine
manifest and separate resolution report alongside that exact package archive.
This ensures unpackaged repository files are not confused with an installable
runtime. No Source release pin or activation is filled by this build step.
