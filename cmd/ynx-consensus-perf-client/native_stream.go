package main

import (
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Separate opt-in scope. The original nativeSubmit8 single-round contract and
// the default four-worker ready sender are deliberately unchanged.
func validateNativeStreamingOptions(o options) error {
	if !o.nativeStream8 {
		return nil
	}
	if !o.streamingWorkload || o.senderMode != "ready-pool" || o.rounds < 2 || o.rounds > 4096 || o.concurrency != 8 || o.observers != 4 || !(o.offeredRate > 0) || o.offeredRate > maxTransactions || !o.prefixDurableReplay || !o.prefixNativeClone || !o.observerNativeFacts || !o.observerPhaseTiming || o.nativeSubmit8 || o.nativeSuffixSetup || o.clientProcs2 || o.sharedDurableReplay || o.endpointFair || o.endpointElastic || o.inclusionMode != "block-scan" || !o.terminalStream || !o.reuseResultSlots || !o.segmentedIntents || o.output == "" || o.evidenceByteBudget < 1 || o.evidenceByteBudget > 2<<30 {
		return errors.New("native stream8 requires explicit native-prefix/facts/phase ready streaming,8submitters/4observers/original bounded positive pace,original suffix and no other candidates")
	}
	if _, err := normalizeReadyPacingMode(o.pacingMode); err != nil {
		return err
	}
	_, _, err := durableReadLimits(o)
	return err
}

// Only a fresh construction-time reader may select this backend. The existing
// observation mutex/cache-input eviction budget stays active for large files.
// Its bytes count encoded input, not decoded heap; RSS admission is separate.
// Replace only the unused alternate signature cache with the prefix decoder's
// original bounded, expected-chain/full-byte mathematical-fact cache.
func (r *durableReader) configureNativeStreamingReplay(o options) error {
	if !o.nativeStream8 {
		return errors.New("native streaming reader requires explicit selection")
	}
	if err := validateNativeStreamingOptions(o); err != nil {
		return err
	}
	limit, budget, err := durableReadLimits(o)
	if err != nil {
		return err
	}
	if r == nil || r.prefixDecoder != nil || r.sharedReplay != nil || r.observerNativeFacts || r.storeByteLimit != limit || r.cacheByteBudget != budget || (r.profileMu != nil) != (budget > 0) {
		return errors.New("native streaming reader/backend/resource scope differs")
	}
	for _, slot := range r.slots {
		if slot.state != nil || slot.storeInputBytes != 0 || slot.stats.Attempts != 0 || slot.lastUse != 0 {
			return errors.New("native streaming configuration requires unused reader slots")
		}
	}
	if r.signatureFacts != nil && (len(r.signatureFacts.entries) != 0 || r.signatureFacts.bytes != 0 || r.signatureFacts.hits != 0 || r.signatureFacts.verified != 0) {
		return errors.New("native streaming cannot discard existing signature-cache work")
	}
	decoder, err := consensus.NewBoundedBlockJournalNativeClonePrefixDecoder(r.migration, int(limit))
	if err != nil {
		return err
	}
	r.prefixDecoder = decoder
	r.prefixNativeClone = true
	r.prefixStats.WorkPhases.PrivateNativeClone = new(consensus.BlockJournalPrefixPhase)
	r.signatureFacts = nil
	r.observerNativeFacts = true
	r.measurePhases = true
	return nil
}

// Persist public mode/resource identities before issuance. This is a scoped
// client plan, not a network admission or proof that its target was achieved.
type nativeStreamingPlan struct {
	OfferedRate            float64 `json:"offeredRate"`
	PacingMode             string  `json:"pacingMode"`
	Submitters             int     `json:"submitters"`
	Observers              int     `json:"observers"`
	CanonicalByteLimit     int64   `json:"canonicalByteLimit"`
	ObserverNativeFacts    bool    `json:"observerNativeFacts"`
	OriginalSuffixSetup    bool    `json:"originalSuffixSetup"`
	SerializedReaderBudget bool    `json:"serializedReaderBudget"`
}

func streamingProfileName(o options) string {
	if o.nativeStream8 {
		return "scoped_native_prefix_stream8_v1"
	}
	return "scoped_streaming_v1"
}
