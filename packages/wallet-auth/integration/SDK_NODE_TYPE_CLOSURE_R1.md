# Explicit Node-only type closure and browser isolation

The real Linux SDK job passed 71 runtime controls, then failed TS2307 on node:buffer in original-ide-parent-host.d.ts. Earlier Mac checks accidentally resolved ancestor @types/node22.13.9. A source-matching tar and local tsc exit0 did not establish an independent declared type closure.

This successor keeps the actual Buffer ABI. The Node-only declaration explicitly references node types. @types/node24.13.3 is an exact development dependency with lock integrity; >=22.13.9 is an optional consumer type peer. Browser consumers are not forced to load the Node entry or its globals. The existing runtime/provider dependency pins remain unchanged.

Normal type validation now checks the main contract, a DOM-only browser-root consumer with types:[] (Buffer/process must remain absent), and the actual private Node entry with types:[] (its own declaration must supply the explicit Node reference). Each project refuses ancestor ambient @types or node_modules aliases. Node projects require the locally declared exact development type version. No skipLibCheck, weakened Buffer signature or removed test substitutes for the missing dependency.

The canonical SDK push runs one existing workflow SDK job; the PR duplicate event does not execute a second copy. Original App/Native job boundaries and all signing/release gates remain unchanged.
