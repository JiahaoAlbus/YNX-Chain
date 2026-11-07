package securelink

// NativeLocalCallerBinding is startup-owned transport DATA. It must name one
// of the actual client's already registered routes. No C request can set it.
// Indices 0..2 are POST, 3..4 are GET. A fully zero binding disables that slot;
// at least one slot must be enabled. LINK does not implement their business.
type NativeLocalCallerBinding struct {
	Method, Path, ContentType string
}
