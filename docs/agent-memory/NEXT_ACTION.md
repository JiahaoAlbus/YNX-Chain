# YNX Trust Center Next Action

## Execute now

From `apps/trust-center`:

1. read `package.json` and the Playwright configuration to confirm the current bounded test command and output paths;
2. run the current Web UI suite against the frozen branch, including desktop and 390px mobile coverage;
3. verify Arabic RTL, locale persistence, keyboard focus order, reduced-motion behavior, accessible names and the explicit failure states;
4. preserve fresh desktop/mobile evidence under the existing Trust evidence structure;
5. update `UI_DESIGN_AUDIT.md`, `FEATURE_COMPLETION_EVIDENCE.md`, `.ai-bridge/full-goal-coverage.json`, `product-release.json` and this Agent Memory with exact commands and results;
6. commit and push the UI evidence as an independent slice, then verify Local SHA = Remote SHA.

Do not promote `deployedPublic`, `integratedCentral`, `productionSigned` or `storeReleased` based on local browser evidence.

## After the UI slice

Run the current Android debug build. Install and cold-launch only when ADB reports a healthy device or emulator with a working package service. For iOS, run syntax/plist checks immediately and use Xcode/Simulator only when the full toolchain is available. Record unavailable toolchains as precise environment constraints, not as completed evidence.
