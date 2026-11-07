//go:build unix

package consensus

import "path/filepath"

// This is timing classification, never a path, digest, authority or durability
// receipt. Only the six existing original record roles have bounded names.
func pqLabMeasureSenderPersistence(metrics *PQLabMetrics, path, phase string) func() {
	if metrics == nil {
		return func() {}
	}
	var role string
	switch filepath.Base(path) {
	case "request.json":
		role = "request"
	case "INTENT.json":
		role = "intent"
	case "transaction.wire":
		role = "wire"
	case "transaction.abci":
		role = "envelope"
	case "RESULT.json":
		role = "result"
	case "CONFIRMED.json":
		role = "confirmed"
	default:
		return func() {}
	}
	return pqLabMeasure(metrics, "sender.persistence."+role+"."+phase)
}
