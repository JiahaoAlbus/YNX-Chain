import type { MatrixMediaLease } from './nativeMatrixMedia';

export type MediaPresentationScope = Readonly<{
  preview: object;
  roomId: string;
  eventId: string;
}>;
export type BoundMediaPresentation = Readonly<{
  scope: MediaPresentationScope;
  lease: MatrixMediaLease;
}>;

// Effect cleanup happens after render. The render boundary must independently
// refuse a previous room/event/preview's decrypted URI before an Image mounts.
export function bindMediaPresentation(scope: MediaPresentationScope, lease: MatrixMediaLease): BoundMediaPresentation {
  if (lease.roomId !== scope.roomId || lease.eventId !== scope.eventId) {
    throw new Error('MEDIA_PRESENTATION_SCOPE_MISMATCH');
  }
  return Object.freeze({ scope: Object.freeze({ ...scope }), lease: Object.freeze({ ...lease }) });
}

export function visibleMediaPresentation(scope: MediaPresentationScope,
  presentation: BoundMediaPresentation | undefined): MatrixMediaLease | undefined {
  if (!presentation || presentation.scope.preview !== scope.preview ||
    presentation.scope.roomId !== scope.roomId || presentation.scope.eventId !== scope.eventId) return undefined;
  return presentation.lease;
}
