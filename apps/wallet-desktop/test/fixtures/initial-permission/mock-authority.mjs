// Explicit TEST ONLY Main private-brand boundary, never supplied as production.
const borrows=new WeakSet();export const mockBrand=v=>borrows.add(v);
export const isOriginalPQAccountInitialReviewBorrow=v=>borrows.has(v);
