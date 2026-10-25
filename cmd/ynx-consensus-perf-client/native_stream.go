package main

import (
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Separate opt-in scope. The original nativeSubmit8 single-round contract and
// the default four-worker ready sender are deliberately unchanged.
func validateNativeStreamingOptions(o options) error {
	if o.nativeStream8 && o.clientProcs2 && (!o.nativePreparedCertificate || !o.nativeCurrentInputReuse || o.concurrency != 8 || o.nativeStreamSubmitters != 0 || o.pacingMode != "grouped-cadence4" || o.nativeCachedFeeJSON || o.nativeCanonicalCertificate || o.nativeSuffixSetup || o.nativeBlockTipHint) {
		return errors.New("stream client procs2 requires isolated prepared/current-reuse8 grouped pacing and original hash encoding")
	}
	if o.nativeStream8 && o.pacingMode == "grouped-cadence4" && (!o.nativePreparedCertificate || !o.nativeCurrentInputReuse || o.concurrency != 8 || o.nativeStreamSubmitters != 0 || o.nativeCachedFeeJSON) {
		return errors.New("grouped native stream requires explicit prepared/current-reuse8 and original hash encoding")
	}
	if o.nativeCachedFeeJSON && (!o.nativeStream8 || !o.nativePreparedCertificate || !o.nativeCurrentInputReuse || o.nativeStreamSubmitters != 0 || o.concurrency != 8 || o.clientProcs2 || o.nativeCanonicalCertificate || o.nativeSuffixSetup || o.nativeBlockTipHint || o.pacingMode == "grouped-cadence4") {
		return errors.New("cached fee JSON requires explicit prepared/current-reuse native stream8 and no mixed candidate")
	}
	if o.nativePreparedCertificate && (!o.nativeStream8 || o.nativeCanonicalCertificate || o.nativeSuffixSetup || o.nativeBlockTipHint) {
		return errors.New("prepared certificate requires explicit native stream and no mixed construction/tip candidate")
	}
	if o.nativeStreamSubmitters != 0 && (o.nativeStreamSubmitters != 16 || !o.nativeStream8 || o.concurrency != 16) {
		return errors.New("explicit native stream submitters requires stream16 and concurrency16")
	}
	expectedSubmitters := 8
	if o.nativeStreamSubmitters == 16 {
		expectedSubmitters = 16
	}

	if o.nativeBlockTipHint && (!o.nativeStream8 || o.nativeCanonicalCertificate || o.nativeSuffixSetup) {
		return errors.New("block tip hint requires native streaming and no mixed construction candidate")
	}
	if !o.nativeStream8 {
		if o.nativeCanonicalCertificate {
			return errors.New("canonical certificate requires explicit native stream")
		}
		if o.nativeCurrentInputReuse {
			return errors.New("current input reuse requires explicit native stream")
		}
		return nil
	}
	if !o.streamingWorkload || o.senderMode != "ready-pool" || o.rounds < 2 || o.rounds > 4096 || o.concurrency != expectedSubmitters || o.observers != 4 || !(o.offeredRate > 0) || o.offeredRate > maxTransactions || !o.prefixDurableReplay || !o.prefixNativeClone || !o.observerNativeFacts || !o.observerPhaseTiming || o.nativeSubmit8 || o.nativeSuffixSetup && o.nativeCanonicalCertificate || o.sharedDurableReplay || o.endpointFair || o.endpointElastic || o.inclusionMode != "block-scan" || !o.terminalStream || !o.reuseResultSlots || !o.segmentedIntents || o.output == "" || o.evidenceByteBudget < 1 || o.evidenceByteBudget > 2<<30 {
		return errors.New("native stream requires explicit native-prefix/facts/phase ready streaming,selected8or16submitters/4observers/original bounded positive pace and at most one certificate/suffix construction candidate")
	}
	if _, err := normalizeReadyPacingMode(o.pacingMode); err != nil {
		return err
	}
	_, budget, err := durableReadLimits(o)
	if err == nil && o.nativeCurrentInputReuse && budget == 0 {
		return errors.New("current input reuse requires explicit original cache budget")
	}
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
	mode, _, _ := consensus.StateHashEncodingMeasurements()
	expectedMode := consensus.StateHashOriginalJSON
	if o.nativeCachedFeeJSON {
		expectedMode = consensus.StateHashCachedFeeJSON
	}
	if mode != expectedMode {
		return errors.New("actual client process hash encoding differs from selected reader")
	}
	limit, budget, err := durableReadLimits(o)
	if err != nil {
		return err
	}
	if r == nil || r.prefixDecoder != nil || r.sharedReplay != nil || r.observerNativeFacts || r.storeByteLimit != limit || r.cacheByteBudget != budget || (r.profileMu != nil) != (budget > 0) {
		return errors.New("native streaming reader/backend/resource scope differs")
	}
	if o.nativeCurrentInputReuse && r.profileMu == nil {
		return errors.New("current input reuse requires original serialized budget")
	}
	for _, slot := range r.slots {
		if slot.state != nil || slot.storeInputBytes != 0 || slot.stats.Attempts != 0 || slot.lastUse != 0 {
			return errors.New("native streaming configuration requires unused reader slots")
		}
	}
	if r.signatureFacts != nil && (len(r.signatureFacts.entries) != 0 || r.signatureFacts.bytes != 0 || r.signatureFacts.hits != 0 || r.signatureFacts.verified != 0) {
		return errors.New("native streaming cannot discard existing signature-cache work")
	}
	constructor := consensus.NewBoundedBlockJournalNativeClonePrefixDecoder
	if o.nativePreparedCertificate {
		constructor = consensus.NewBoundedBlockJournalPreparedNativePrefixDecoder
	} else if o.nativeCanonicalCertificate {
		constructor = consensus.NewBoundedBlockJournalCanonicalNativePrefixDecoder
	} else if o.nativeSuffixSetup {
		constructor = consensus.NewBoundedBlockJournalNativeSuffixPrefixDecoder
	}
	decoder, err := constructor(r.migration, int(limit))
	if err != nil {
		return err
	}
	if decoder.NativeSuffixSetupEnabled() != o.nativeSuffixSetup {
		return errors.New("actual native suffix constructor differs from selected mode")
	}
	r.nativeCurrentInputReuse = o.nativeCurrentInputReuse
	r.currentInputScopeChainID = r.migration.Network.ChainID
	r.currentInputReuseStats.Enabled = o.nativeCurrentInputReuse
	r.prefixDecoder = decoder
	r.prefixNativeClone = true
	if decoder.PreparedNativePublicationEnabled() != o.nativePreparedCertificate {
		return errors.New("actual prepared publication constructor differs")
	}
	r.prefixStats.PreparedCertificate = o.nativePreparedCertificate
	r.prefixStats.CanonicalCertificate = o.nativeCanonicalCertificate
	r.prefixStats.NativeSuffixSetup = decoder.NativeSuffixSetupEnabled()
	r.prefixStats.WorkPhases.PrivateNativeClone = new(consensus.BlockJournalPrefixPhase)
	r.signatureFacts = nil
	r.observerNativeFacts = true
	r.measurePhases = true
	r.measureCertificatePhases = true
	r.prefixStats.WorkPhases.CertificatePublishDetails = new(consensus.BlockJournalPrefixCertificatePhases)
	if r.profileMu != nil {
		r.readerGate = &durableReaderGateStats{}
	}
	return nil
}

// Persist public mode/resource identities before issuance. This is a scoped
// client plan, not a network admission or proof that its target was achieved.
type nativeStreamingPlan struct {
	ClientProcs2           bool    `json:"clientProcs2,omitempty"`
	ClientCachedFeeJSON    bool    `json:"clientCachedFeeJSON,omitempty"`
	BlockTipHint           bool    `json:"blockTipHint,omitempty"`
	PreparedCertificate    bool    `json:"preparedCertificate,omitempty"`
	CanonicalCertificate   bool    `json:"canonicalCertificate,omitempty"`
	CurrentInputReuse      bool    `json:"currentInputReuse"`
	ClientClockTiming      bool    `json:"clientClockTiming"`
	ReaderGateTiming       bool    `json:"readerGateTiming"`
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
		if o.nativeCachedFeeJSON {
			return "scoped_native_prefix_stream8_prepared_cached_fee_v1"
		}
		if o.nativePreparedCertificate {
			if o.clientProcs2 {
				return "scoped_native_prefix_stream8_prepared_grouped_procs2_v1"
			}
			if o.nativeStreamSubmitters == 16 {
				return "scoped_native_prefix_stream16_prepared_v1"
			}
			return "scoped_native_prefix_stream8_prepared_v1"
		}
		if o.nativeStreamSubmitters == 16 {
			return "scoped_native_prefix_stream16_v1"
		}
		return "scoped_native_prefix_stream8_v1"
	}
	return "scoped_streaming_v1"
}
