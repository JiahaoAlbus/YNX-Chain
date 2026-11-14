//go:build pay_pq

package payproduct

import "errors"

// OriginData is the immutable constructor-selected observation endpoint. It
// supplies no engine/Root/Source authority; the original release must bind it.
func (h *NativePayHTTP) OriginData() (string, error) {
	if h == nil {
		return "", errors.New("native Pay HTTP caller is not configured")
	}
	return h.origin, nil
}

// Engine identifies this original Comet-RPC transport contract, not caller
// selected runtime authority. Native producer DTOs are not this contract.
func (h *NativePayHTTP) Engine() string { return "bft" }
