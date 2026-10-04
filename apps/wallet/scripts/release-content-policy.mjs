// JavaScript \b treats accented and non-Latin letters as boundaries. Match
// standalone markers using Unicode letters, numbers, combining marks and "_".
// This keeps real annotations blocked without rejecting translated words.
export const RELEASE_MARKER_PATTERNS=Object.freeze([
  Object.freeze(["TODO marker",/(?<![\p{L}\p{N}\p{M}_])TODO(?![\p{L}\p{N}\p{M}_])/iu]),
  Object.freeze(["FIXME marker",/(?<![\p{L}\p{N}\p{M}_])FIXME(?![\p{L}\p{N}\p{M}_])/iu]),
]);
