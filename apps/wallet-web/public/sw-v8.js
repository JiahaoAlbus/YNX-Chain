// A versioned entrypoint bypasses stale Workers that cached historical /sw.js
// responses. The imported runtime remains the single cache and integrity policy.
import "./sw.js?schema=8";
