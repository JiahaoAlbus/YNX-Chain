// A locator is not a lifecycle identity: A -> B -> A must retire the first A.
// Invalidating synchronously also closes the render/effect gap at logout.
export function createRequestEpoch() {
  let epoch = 0;
  return {
    capture: () => epoch,
    invalidate: () => ++epoch,
    current: (captured: number) => captured === epoch,
  };
}
