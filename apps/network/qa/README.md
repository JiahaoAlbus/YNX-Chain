# Independent local QA client

Build a clean complete candidate on macOS ARM64:

```sh
node apps/network/qa/build.mjs --out-dir /absolute/independent/output --expect-head EXACT_40_CHARACTER_SHA
```

`--plan` captures the actual clean/dirty source, exact Go dependency/embed input hashes and target without packaging. The builder refuses dirty source, source changes during compilation, an existing versioned output and `/Applications` output. It uses the existing helper and original CORE proof executable, current embedded PWA, and system clang/Cocoa/WebKit. It does not invoke signing, notarization, installation or alter an existing App. Linker-produced signature observations are recorded separately from publisher signing.

The bundle's normal entries are `YNX Network QA.app` and `START.command`. `START.command --headless` runs the same packaged helper through its normal CLI; `--native-status` queries its actual kernel peer channel. `--version` prints QA build identity. The native shell displays the helper's one-use pairing code and confines navigation to that helper's exact loopback origin; it does not automatically approve or give browser tickets native authority. Quit stops only its owned helper.

Each exact source build uses its own private `~/.ynx-network-qa/qa-<identity>/` directory. Existing product directories and other versions are preserved. No independent chain trust context is bundled or inferred; queries remain RPC_ONLY until the genuine original context is separately configured through the documented helper interface. The original offline proof tool is included under `Contents/Helpers`.

`source-manifest.json` records HEAD, source state, exact source/embed hashes, compiler identity, executable SHA256, actual service version and observed signatures. QA build, functional process acceptance, GUI, install, publisher signing and public release are separate gates.
