package consensus

import "time"

// These wall durations are sequential children of one decoder call. Gate wait
// includes scheduling while contending; full/suffix replay retain their original
// nested validation semantics. Counters include failed attempts, not only outputs.
type BlockJournalPrefixPhase struct {
	Calls      uint64 `json:"calls"`
	Errors     uint64 `json:"errors"`
	DurationNs int64  `json:"durationNs"`
}
type BlockJournalPrefixWorkPhases struct {
	GateWait           BlockJournalPrefixPhase `json:"gateWait"`
	PrefixCheck        BlockJournalPrefixPhase `json:"prefixCheck"`
	PrivateJSON        BlockJournalPrefixPhase `json:"privateJSON"`
	PrivateValidate    BlockJournalPrefixPhase `json:"privateValidate"`
	FullReplay         BlockJournalPrefixPhase `json:"fullReplay"`
	SuffixSetup        BlockJournalPrefixPhase `json:"suffixSetup"`
	SuffixReplay       BlockJournalPrefixPhase `json:"suffixReplay"`
	SuffixEncode       BlockJournalPrefixPhase `json:"suffixEncode"`
	CanonicalCopy      BlockJournalPrefixPhase `json:"canonicalCopy"`
	CertificatePublish BlockJournalPrefixPhase `json:"certificatePublish"`
}

func (p *BlockJournalPrefixWorkPhases) measure(name string, action func() error) error {
	if p == nil {
		return action()
	}
	var phase *BlockJournalPrefixPhase
	switch name {
	case "gateWait":
		phase = &p.GateWait
	case "prefixCheck":
		phase = &p.PrefixCheck
	case "privateJSON":
		phase = &p.PrivateJSON
	case "privateValidate":
		phase = &p.PrivateValidate
	case "fullReplay":
		phase = &p.FullReplay
	case "suffixSetup":
		phase = &p.SuffixSetup
	case "suffixReplay":
		phase = &p.SuffixReplay
	case "suffixEncode":
		phase = &p.SuffixEncode
	case "canonicalCopy":
		phase = &p.CanonicalCopy
	case "certificatePublish":
		phase = &p.CertificatePublish
	default:
		panic("unregistered prefix decoder phase")
	}
	started := time.Now()
	phase.Calls++
	err := action()
	phase.DurationNs += time.Since(started).Nanoseconds()
	if err != nil {
		phase.Errors++
	}
	return err
}

// Add copies counters from a completed call, including failed phase attempts.
func (p *BlockJournalPrefixWorkPhases) Add(other BlockJournalPrefixWorkPhases) {
	targets := []*BlockJournalPrefixPhase{&p.GateWait, &p.PrefixCheck, &p.PrivateJSON, &p.PrivateValidate, &p.FullReplay, &p.SuffixSetup, &p.SuffixReplay, &p.SuffixEncode, &p.CanonicalCopy, &p.CertificatePublish}
	values := []BlockJournalPrefixPhase{other.GateWait, other.PrefixCheck, other.PrivateJSON, other.PrivateValidate, other.FullReplay, other.SuffixSetup, other.SuffixReplay, other.SuffixEncode, other.CanonicalCopy, other.CertificatePublish}
	for i, v := range values {
		targets[i].Calls += v.Calls
		targets[i].Errors += v.Errors
		targets[i].DurationNs += v.DurationNs
	}
}
