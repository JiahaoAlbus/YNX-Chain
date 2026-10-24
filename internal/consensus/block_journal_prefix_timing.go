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
	PreparedEncodeDetails     *BlockJournalPreparedEncodePhases    `json:"preparedEncodeDetails,omitempty"`
	SuffixReplayDetails       *BlockJournalFrameReplayPhases       `json:"suffixReplayDetails,omitempty"`
	CertificatePublishDetails *BlockJournalPrefixCertificatePhases `json:"certificatePublishDetails,omitempty"`
	GateWait                  BlockJournalPrefixPhase              `json:"gateWait"`
	PrefixCheck               BlockJournalPrefixPhase              `json:"prefixCheck"`
	PrivateJSON               BlockJournalPrefixPhase              `json:"privateJSON"`
	PrivateValidate           BlockJournalPrefixPhase              `json:"privateValidate"`
	FullReplay                BlockJournalPrefixPhase              `json:"fullReplay"`
	SuffixSetup               BlockJournalPrefixPhase              `json:"suffixSetup"`
	SuffixReplay              BlockJournalPrefixPhase              `json:"suffixReplay"`
	SuffixEncode              BlockJournalPrefixPhase              `json:"suffixEncode"`
	CanonicalCopy             BlockJournalPrefixPhase              `json:"canonicalCopy"`
	CertificatePublish        BlockJournalPrefixPhase              `json:"certificatePublish"`
	PrivateNativeClone        *BlockJournalPrefixPhase             `json:"privateNativeClone,omitempty"`
}

// Sequential children included in SuffixEncode, enabled only for the explicit
// prepared decoder's certificate timing API. Unsupported input retains the
// original fallback encoder. A normalization fallback is not an error.
type BlockJournalPreparedEncodePhases struct {
	Normalize      BlockJournalPrefixPhase `json:"normalize"`
	JSONEncode     BlockJournalPrefixPhase `json:"jsonEncode"`
	PublicCopy     BlockJournalPrefixPhase `json:"publicCopy"`
	FallbackEncode BlockJournalPrefixPhase `json:"fallbackEncode"`
}

func (p *BlockJournalPrefixWorkPhases) measurePrepared(name string, action func() error) error {
	if p == nil || p.PreparedEncodeDetails == nil {
		return action()
	}
	var phase *BlockJournalPrefixPhase
	switch name {
	case "normalize":
		phase = &p.PreparedEncodeDetails.Normalize
	case "jsonEncode":
		phase = &p.PreparedEncodeDetails.JSONEncode
	case "publicCopy":
		phase = &p.PreparedEncodeDetails.PublicCopy
	case "fallbackEncode":
		phase = &p.PreparedEncodeDetails.FallbackEncode
	default:
		panic("unregistered prepared encode phase")
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

// Sequential children already included in CertificatePublish. These counters
// are selected only by DecodeWithCertificatePhaseTiming; the original timed and
// untimed APIs retain their output shape and do not read these child clocks.
type BlockJournalPrefixCertificatePhases struct {
	CanonicalNative         *BlockJournalPrefixPhase `json:"canonicalNative,omitempty"` // Explicit candidate copy plus exact encoded-byte comparison.
	PreparedNativeAccepted  uint64                   `json:"preparedNativeAccepted,omitempty"`
	CanonicalNativeAccepted uint64                   `json:"canonicalNativeAccepted,omitempty"`
	PayloadCopy             BlockJournalPrefixPhase  `json:"payloadCopy"` // Payload ownership (copy or private adoption) plus current input-prefix digest.
	StrictJSON              BlockJournalPrefixPhase  `json:"strictJSON"`
	NativeClone             BlockJournalPrefixPhase  `json:"nativeClone"` // Private state ownership (copy or adoption) plus payload digest/identity sealing.
	PayloadBytes            uint64                   `json:"payloadBytes"`
	PrefixBytesHashed       uint64                   `json:"prefixBytesHashed"`
}

func (p *BlockJournalPrefixWorkPhases) measureCertificate(name string, action func() error) error {
	if p == nil || p.CertificatePublishDetails == nil {
		return action()
	}
	var phase *BlockJournalPrefixPhase
	switch name {
	case "payloadCopy":
		phase = &p.CertificatePublishDetails.PayloadCopy
	case "strictJSON":
		phase = &p.CertificatePublishDetails.StrictJSON
	case "nativeClone":
		phase = &p.CertificatePublishDetails.NativeClone
	case "canonicalNative":
		if p.CertificatePublishDetails.CanonicalNative == nil {
			p.CertificatePublishDetails.CanonicalNative = new(BlockJournalPrefixPhase)
		}
		phase = p.CertificatePublishDetails.CanonicalNative
	default:
		panic("unregistered certificate publish phase")
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
	case "privateNativeClone":
		if p.PrivateNativeClone == nil {
			p.PrivateNativeClone = new(BlockJournalPrefixPhase)
		}
		phase = p.PrivateNativeClone
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
	if other.PreparedEncodeDetails != nil {
		if p.PreparedEncodeDetails == nil {
			p.PreparedEncodeDetails = new(BlockJournalPreparedEncodePhases)
		}
		target, source := p.PreparedEncodeDetails, other.PreparedEncodeDetails
		targets := []*BlockJournalPrefixPhase{&target.Normalize, &target.JSONEncode, &target.PublicCopy, &target.FallbackEncode}
		for i, value := range []BlockJournalPrefixPhase{source.Normalize, source.JSONEncode, source.PublicCopy, source.FallbackEncode} {
			targets[i].Calls += value.Calls
			targets[i].Errors += value.Errors
			targets[i].DurationNs += value.DurationNs
		}
	}
	if other.SuffixReplayDetails != nil {
		if p.SuffixReplayDetails == nil {
			p.SuffixReplayDetails = new(BlockJournalFrameReplayPhases)
		}
		p.SuffixReplayDetails.add(*other.SuffixReplayDetails)
	}
	if other.CertificatePublishDetails != nil {
		if p.CertificatePublishDetails == nil {
			p.CertificatePublishDetails = new(BlockJournalPrefixCertificatePhases)
		}
		target, source := p.CertificatePublishDetails, other.CertificatePublishDetails
		target.CanonicalNativeAccepted += source.CanonicalNativeAccepted
		target.PreparedNativeAccepted += source.PreparedNativeAccepted
		if source.CanonicalNative != nil {
			if target.CanonicalNative == nil {
				target.CanonicalNative = new(BlockJournalPrefixPhase)
			}
			target.CanonicalNative.Calls += source.CanonicalNative.Calls
			target.CanonicalNative.Errors += source.CanonicalNative.Errors
			target.CanonicalNative.DurationNs += source.CanonicalNative.DurationNs
		}
		target.PayloadBytes += source.PayloadBytes
		target.PrefixBytesHashed += source.PrefixBytesHashed
		targets := []*BlockJournalPrefixPhase{&target.PayloadCopy, &target.StrictJSON, &target.NativeClone}
		for i, v := range []BlockJournalPrefixPhase{source.PayloadCopy, source.StrictJSON, source.NativeClone} {
			phase := targets[i]
			phase.Calls += v.Calls
			phase.Errors += v.Errors
			phase.DurationNs += v.DurationNs
		}
	}
	if other.PrivateNativeClone != nil {
		if p.PrivateNativeClone == nil {
			p.PrivateNativeClone = new(BlockJournalPrefixPhase)
		}
		p.PrivateNativeClone.Calls += other.PrivateNativeClone.Calls
		p.PrivateNativeClone.Errors += other.PrivateNativeClone.Errors
		p.PrivateNativeClone.DurationNs += other.PrivateNativeClone.DurationNs
	}
	targets := []*BlockJournalPrefixPhase{&p.GateWait, &p.PrefixCheck, &p.PrivateJSON, &p.PrivateValidate, &p.FullReplay, &p.SuffixSetup, &p.SuffixReplay, &p.SuffixEncode, &p.CanonicalCopy, &p.CertificatePublish}
	values := []BlockJournalPrefixPhase{other.GateWait, other.PrefixCheck, other.PrivateJSON, other.PrivateValidate, other.FullReplay, other.SuffixSetup, other.SuffixReplay, other.SuffixEncode, other.CanonicalCopy, other.CertificatePublish}
	for i, v := range values {
		targets[i].Calls += v.Calls
		targets[i].Errors += v.Errors
		targets[i].DurationNs += v.DurationNs
	}
}
