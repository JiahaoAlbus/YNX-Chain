// A versioned entrypoint deliberately bypasses stale Workers that cached the
// historical /sw.js response. The imported runtime remains the single source
// of cache and integrity policy.
import "./sw.js?schema=7";
