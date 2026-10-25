// Explicit TEST ONLY native Window/IPC identity boundary.
const windows=new WeakMap();export const BrowserWindow={fromWebContents:v=>windows.get(v),mockSet:(v,w)=>windows.set(v,w)};
