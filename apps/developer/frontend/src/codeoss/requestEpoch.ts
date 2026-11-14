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

// Window-local selection; server admission remains the authorization source.
// Retire callbacks before React renders or effects process the selection.
export function createProjectRequestEpoch(initialProject: string) {
  const requests = createRequestEpoch();
  let project = initialProject;
  return {
    ...requests,
    project: () => project,
    activate: (nextProject: string) => {
      requests.invalidate();
      project = nextProject;
    },
  };
}
