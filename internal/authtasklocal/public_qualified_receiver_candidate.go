//go:build link_receiver_purpose_candidate && (darwin || linux)

package tasklocalsource

import native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"

// TEST ONLY concrete assembly, no receiver interface/mock/provider or row.
func PUBLICOwnerWithQualifiedReceiverForP08Test(r *native.Runtime, q *native.TaskReadReceiverRuntime) *Owner {
	return &Owner{runtime: r, receiver: q, children: make(map[*heldLocalSource]struct{})}
}
