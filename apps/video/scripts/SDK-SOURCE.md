# Viewer browser SDK source

The browser bundle is built from the entire Wallet Auth public `src/index.js`.
It preserves the SDK529 package used by Viewer 77ac and applies the reviewed
download-only client addition from 5d. It does not replace an Auth server.

- Baseline Viewer: `77ac093356e8517e16d6280c8a01a598791d2d0d`
- Baseline SDK: `529471f3822d2bac43ea47a1ab8004fa2ae79885`
- Identical baseline package tree: `726f45aa1a66709cfd9711012c6166780a0399be`
- Additive source: `5d468432d75b261684523810a9f5c775a306c330`
- Patch paths: `packages/wallet-auth/src/index.js`, `src/index.d.ts`,
  `src/wallet-downloads.js`, and `test/wallet-downloads.test.mjs` under that package.

To reproduce, export the complete baseline package with `git archive` to an
empty temporary directory. Apply the exact four-file `git show` patch from 5d
using `git apply --check` followed by `git apply`. Install only dependencies
from the baseline `package-lock.json` with `npm ci --ignore-scripts`. Bundle
with esbuild 0.28.1 using these options, where `sdkRoot` is the exported package:

```js
await esbuild.build({
  absWorkingDir: sdkRoot,
  entryPoints: ['src/index.js'],
  outfile: outputFile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: false,
  metafile: true,
  legalComments: 'inline',
});
```

The committed `product-session-sdk-source.json` binds the complete bundle,
the unchanged product registry, dependency lock, composite source archive,
and per-file composite source manifest. Its original `sourceArchive` and
`authPublicSourceCommit` fields describe historical baseline provenance;
they do not identify a new server deployment. Deployment envelopes separately
check the actual Auth744 service and preserve it.

The download catalogs are vendored snapshots of published immutable files.
Only SDK artifacts whose URL, hash, size, source, platform, architecture,
browser, MIME type, filename, and installation format match verified publisher
metadata receive links. Device hints never imply an installed wallet or account
authorization. Preview installation limits are visible beside the download.
