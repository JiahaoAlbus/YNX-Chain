# Chrome real-UI attempt — blocked before browser interaction

The requested next step was to load the exact existing extension through Chrome's real `chrome://extensions` developer-mode / Load unpacked UI in an isolated disposable profile, then use a real toolbar/action click for HTTP activeTab authorization. No command-line extension loading, synthetic page shortcut, CDP authorization or browser-policy change was to substitute for these actions.

The first native UI call was:

```javascript
let chromeApp = await cua.getApp("Google Chrome");
```

The native tool returned:

> The Mac is locked and automatic unlock could not unlock it. Ask the user to unlock the Mac manually before continuing.

No accessibility state or screenshot was available. Work stopped at that boundary. No isolated profile was created, no browser setting or policy changed, and no UI grant/install/provider check occurred. There was therefore no profile to clean up. No alternate automation or unlock bypass was attempted.

The user must manually unlock the Mac before this flow can resume from a fresh native UI observation. Chrome HTTPS provider, HTTP positive action, unauthorized-tab isolation and restart behavior remain unproved by this attempt. Earlier Firefox/Edge browser results remain separate evidence and do not close these Chrome gaps.

This is an evidence-only update. Product, manifests and tests are unchanged; no tests were rerun for the native environment blockage. `result.json` preserves the exact error and explicit false states.
