//go:build unix

package consensus

// PQLabSenderSourceStats describes raw public originals retained by one normal
// sender input owner. Repeated identical file contents count separately because
// the original loader owns their separate descriptors and byte slices.
// This is a locked memory snapshot, not a current-file/permission check. It
// exposes no paths, source bytes, keys, transactions, nonces or authority.
// Counts are retained raw-input footprint, not disk allocation, I/O, wire bytes
// or bytes per effective transaction. A changed file can have the same footprint.
type PQLabSenderSourceStats struct {
	Scope                   string `json:"scope"`
	State                   string `json:"state"`
	StaticOriginalFiles     int    `json:"staticOriginalFiles"`
	StaticOriginalBytes     int64  `json:"staticOriginalBytes"`
	ActivationOriginalFiles int    `json:"activationOriginalFiles"`
	ActivationOriginalBytes int64  `json:"activationOriginalBytes"`
	CacheRetained           bool   `json:"cacheRetained"`
	CacheAdmissionReason    string `json:"cacheAdmissionReason"`
	CacheMaxBytes           int64  `json:"cacheMaxBytes"`
	CacheMaxFiles           int    `json:"cacheMaxFiles"`
	SnapshotOnly            bool   `json:"snapshotOnly"`
}

func (s *PQLabSenderCheckpointSource) SourceStats() PQLabSenderSourceStats {
	out := PQLabSenderSourceStats{Scope: "YNX-PQ-LAB-HELD-PUBLIC-INPUTS/v1", State: "NOT_LOADED", CacheAdmissionReason: "NOT_EVALUATED", CacheMaxBytes: pqLabStaticMaxBytes, CacheMaxFiles: pqLabStaticMaxFiles, SnapshotOnly: true}
	if s == nil {
		return out
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		out.State = "CLOSED"
		return out
	}
	if s.cache == nil {
		return out
	}
	s.cache.mu.Lock()
	defer s.cache.mu.Unlock()
	var originals []*proofHostOriginal
	if s.cache.entry != nil {
		out.State = "CACHE_ENTRY"
		out.CacheRetained = true
		originals = s.cache.entry.originals
	} else if s.inputs != nil && s.inputs.heldStatic != nil && s.inputs.uncached != nil {
		out.State = "INVOCATION_HELD"
		originals = s.inputs.uncached.originals
	}
	if out.State != "NOT_LOADED" {
		out.StaticOriginalFiles = len(originals)
		for _, f := range originals {
			out.StaticOriginalBytes += int64(len(f.raw))
		}
		byteBound := out.StaticOriginalBytes > pqLabStaticMaxBytes
		fileBound := out.StaticOriginalFiles > pqLabStaticMaxFiles
		switch {
		case byteBound && fileBound:
			out.CacheAdmissionReason = "BYTE_AND_FILE_BOUND"
		case byteBound:
			out.CacheAdmissionReason = "BYTE_BOUND"
		case fileBound:
			out.CacheAdmissionReason = "FILE_BOUND"
		case out.CacheRetained:
			out.CacheAdmissionReason = "WITHIN_BOUNDS"
		default:
			out.CacheAdmissionReason = "NOT_RETAINED_WITHIN_BOUNDS"
		}
	}
	if s.activation != nil {
		out.ActivationOriginalFiles = len(s.activation.originals)
		for _, f := range s.activation.originals {
			out.ActivationOriginalBytes += int64(len(f.raw))
		}
	}
	return out
}
