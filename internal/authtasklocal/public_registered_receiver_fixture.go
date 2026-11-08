//go:build link_registered_receiver_interop && (darwin || linux)

package tasklocalsource

import native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"

// Test-only reuse of the original setup() grant selection seam, with the real
// supplied Runtime rather than fixtureRuntime. Receiver always comes from the
// actual zero-input concrete factory; no receiver row, config or getter is set.
func PUBLICOwnerWithGrantForReceiverTest(r *native.Runtime) *Owner {
	o := &Owner{runtime: r, children: make(map[*heldLocalSource]struct{})}
	o.openOriginalTaskReadReceiver()
	return o
}
