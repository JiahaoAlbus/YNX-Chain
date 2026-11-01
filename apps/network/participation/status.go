package participation

import "strconv"

// LocalStatus describes this product's local journal and adapter assembly.
// Configured and WalletPublisherConfigured do not establish Wallet approval,
// native execution, transaction finality, or any authority to publish. Callers
// handle an absent (*Service)(nil) separately.
type LocalStatus struct {
	Code                      string `json:"code"`
	Configured                bool   `json:"configured"`
	WalletPublisherConfigured bool   `json:"walletPublisherConfigured"`
	Stopped                   bool   `json:"stopped"`
	Entries                   string `json:"entries"`
	UnknownEntries            string `json:"unknownEntries"`
}

// LocalStatus is an atomic read of in-memory journal state and current local
// ownership. It never reads a remote capability, signs, publishes, reconciles,
// rewrites the journal, or retires an UNKNOWN operation.
func (s *Service) LocalStatus() LocalStatus {
	s.mu.Lock()
	defer s.mu.Unlock()

	unknown := 0
	for _, entry := range s.data.Entries {
		if entry.State == Unknown {
			unknown++
		}
	}
	status := LocalStatus{
		Code:                      "UNAVAILABLE",
		Configured:                s.reader != nil && s.lock != nil,
		WalletPublisherConfigured: s.wallet != nil,
		Stopped:                   s.data.Stopped,
		Entries:                   strconv.Itoa(len(s.data.Entries)),
		UnknownEntries:            strconv.Itoa(unknown),
	}
	if !status.Configured || s.closed || s.persistErr != nil || s.lock.Check() != nil {
		return status
	}
	switch {
	case status.Stopped:
		status.Code = "REVOKED"
	case !status.WalletPublisherConfigured:
		status.Code = "UNSUPPORTED"
	default:
		status.Code = "CONFIGURED"
	}
	return status
}
