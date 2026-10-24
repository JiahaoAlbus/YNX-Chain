package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const blockJournalPrefixLimit = 16 << 20

// BlockJournalPrefixDecoder is a separate opt-in, read-only candidate. It keeps
// one independently encoded previously validated state and exact input-prefix
// digest. It does not change DecodeBlockJournal or the node writer protocol.
// It must not be copied. Callers still capture stable current bytes and verify
// publication/quorum/business evidence independently.
type BlockJournalPrefixDecoder struct {
	full              *BlockJournalDecoder
	gate              chan struct{}
	prefix            *blockJournalPrefix
	nativeClone       bool
	nativeSuffixSetup bool
	canonicalNative   bool
	preparedNative    bool
	byteLimit         int // Immutable; zero preserves the original16MiB limit.
}
type blockJournalPrefix struct {
	payload           []byte
	digest            [sha256.Size]byte
	end               int
	blocks            int
	height            int64
	native            *CommittedState
	payloadDigest     [sha256.Size]byte
	nativeAppHash     string
	nativeInitialized bool
}
type BlockJournalPrefixReadback struct {
	BlockJournalReadback
	ReusedPrefixBytes int
	WorkPhases        *BlockJournalPrefixWorkPhases `json:"workPhases,omitempty"`
}

func NewBlockJournalPrefixDecoder(migration chain.ConsensusMigrationState) (*BlockJournalPrefixDecoder, error) {
	full, err := NewBlockJournalDecoder(migration)
	if err != nil {
		return nil, err
	}
	d := &BlockJournalPrefixDecoder{full: full, gate: make(chan struct{}, 1)}
	d.gate <- struct{}{}
	return d, nil
}

// NewBlockJournalNativeClonePrefixDecoder is an explicit read-only candidate.
// The original constructor remains the JSON reconstruction control. This adds
// one private native snapshot to the bounded canonical certificate; native clone
// memory must be included in real runtime RSS admission/measurement.
func NewBlockJournalNativeClonePrefixDecoder(migration chain.ConsensusMigrationState) (*BlockJournalPrefixDecoder, error) {
	d, err := NewBlockJournalPrefixDecoder(migration)
	if err == nil {
		d.nativeClone = true
	}
	return d, err
}

// NewBlockJournalNativeSuffixPrefixDecoder selects the private suffix initializer
// explicitly. The existing native clone constructor retains NewApplication setup.
func NewBlockJournalNativeSuffixPrefixDecoder(migration chain.ConsensusMigrationState) (*BlockJournalPrefixDecoder, error) {
	d, err := NewBlockJournalNativeClonePrefixDecoder(migration)
	if err == nil {
		d.nativeSuffixSetup = true
	}
	return d, err
}

// NewBlockJournalCanonicalNativePrefixDecoder explicitly selects canonical native
// certificate construction. Unsupported shapes or differing canonical bytes use
// the original strict JSON path. All replay and private full validation remain.
func NewBlockJournalCanonicalNativePrefixDecoder(migration chain.ConsensusMigrationState) (*BlockJournalPrefixDecoder, error) {
	d, err := NewBlockJournalNativeSuffixPrefixDecoder(migration)
	if err == nil {
		d.canonicalNative = true
	}
	return d, err
}
func (d *BlockJournalPrefixDecoder) Decode(ctx context.Context, data []byte) (BlockJournalPrefixReadback, error) {
	return d.decode(ctx, data, nil)
}

// DecodeWithPhaseTiming measures this call only. The untimed API retains its
// original validation/error behavior and performs no phase clock reads.
// Even failed/cancelled calls return their private attempted-phase counters.
func (d *BlockJournalPrefixDecoder) DecodeWithPhaseTiming(ctx context.Context, data []byte) (BlockJournalPrefixReadback, error) {
	phases := new(BlockJournalPrefixWorkPhases)
	out, err := d.decode(ctx, data, phases)
	out.WorkPhases = phases
	return out, err
}

// DecodeWithCertificatePhaseTiming additionally measures the existing payload
// capture, strict JSON normalization and native clone inside certificatePublish.
// It changes no validation, publication, high-water or byte ownership rules.
func (d *BlockJournalPrefixDecoder) DecodeWithCertificatePhaseTiming(ctx context.Context, data []byte) (BlockJournalPrefixReadback, error) {
	phases := &BlockJournalPrefixWorkPhases{CertificatePublishDetails: new(BlockJournalPrefixCertificatePhases)}
	if d != nil && d.preparedNative {
		phases.PreparedEncodeDetails = new(BlockJournalPreparedEncodePhases)
	}
	out, err := d.decode(ctx, data, phases)
	out.WorkPhases = phases
	return out, err
}

// DecodeWithSuffixReplayPhaseTiming measures only incremental replay children.
// Cold full replay retains its original path and produces zero child counters.
func (d *BlockJournalPrefixDecoder) DecodeWithSuffixReplayPhaseTiming(ctx context.Context, data []byte) (BlockJournalPrefixReadback, error) {
	phases := &BlockJournalPrefixWorkPhases{SuffixReplayDetails: new(BlockJournalFrameReplayPhases)}
	out, err := d.decode(ctx, data, phases)
	out.WorkPhases = phases
	return out, err
}

func (d *BlockJournalPrefixDecoder) decode(ctx context.Context, data []byte, phases *BlockJournalPrefixWorkPhases) (BlockJournalPrefixReadback, error) {
	var out BlockJournalPrefixReadback
	if err := ctx.Err(); err != nil {
		return out, err
	}
	if d == nil || d.full == nil || d.gate == nil {
		return out, errors.New("prefix decoder not initialized")
	}
	if len(data) > d.ByteLimit() {
		if d.ByteLimit() == blockJournalPrefixLimit {
			return out, errors.New("prefix decoder input exceeds explicit16MiB bound")
		}
		return out, fmt.Errorf("prefix decoder input exceeds explicit%d-byte bound", d.ByteLimit())
	}
	if err := phases.measure("gateWait", func() error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-d.gate:
			return nil
		}
	}); err != nil {
		return out, err
	}
	defer func() { d.gate <- struct{}{} }()
	if err := ctx.Err(); err != nil {
		return out, err
	}
	p := d.prefix
	reused := false
	_ = phases.measure("prefixCheck", func() error {
		reused = p != nil && p.end > 0 && p.end <= len(data) && sha256.Sum256(data[:p.end]) == p.digest
		return nil
	})
	logicalBlocks := 0
	var prepared *preparedCanonicalNativeSnapshot
	if reused {
		// Always reconstruct private state and fully validate its current AppHash.
		var state CommittedState
		var reconstructErr error
		if d.nativeClone && p.native != nil {
			reconstructErr = phases.measure("privateNativeClone", func() error {
				if sha256.Sum256(p.payload) != p.payloadDigest {
					return errors.New("native prefix canonical certificate changed")
				}
				var ok bool
				state, ok = cloneNativeCommittedState(*p.native)
				if !ok {
					return errors.New("native prefix private schema changed")
				}
				if state.Height != p.height || state.AppHash != p.nativeAppHash || state.Initialized != p.nativeInitialized {
					return errors.New("native prefix state identity changed")
				}
				return nil
			})
		} else {
			reconstructErr = phases.measure("privateJSON", func() error { return decodeStrictJSON(p.payload, &state) })
		}
		if reconstructErr != nil {
			return out, reconstructErr
		}
		if err := phases.measure("privateValidate", func() error { return state.Validate(d.full.migration) }); err != nil {
			return out, err
		}
		if p.end == len(data) {
			// Exact complete input already certified: private decode + full
			// Validate above still ran. No suffix exists to execute or encode.
			if err := ctx.Err(); err != nil {
				return out, err
			}
			var payload []byte
			_ = phases.measure("canonicalCopy", func() error { payload = append([]byte(nil), p.payload...); return nil })
			if err := ctx.Err(); err != nil {
				return out, err
			}
			return BlockJournalPrefixReadback{BlockJournalReadback: BlockJournalReadback{State: state, SnapshotJSON: payload, CompleteBytes: p.end}, ReusedPrefixBytes: p.end}, nil
		}
		var replay *Application
		err := phases.measure("suffixSetup", func() error {
			var e error
			if d.nativeSuffixSetup {
				replay, e = newSuffixApplicationForValidatedPrivateState(d.full.migration, state)
			} else {
				replay, e = NewApplication(d.full.migration)
			}
			return e
		})
		if err != nil {
			return out, err
		}
		replay.committed = state
		replay.replayVerificationFacts = &d.full.native
		j := &blockJournal{io: &snapshotJournal{end: int64(p.end), records: p.blocks + 1}, blocks: p.blocks}
		var next CommittedState
		err = phases.measure("suffixReplay", func() error {
			var e error
			var details *BlockJournalFrameReplayPhases
			if phases != nil {
				details = phases.SuffixReplayDetails
			}
			next, e = replayBlockJournalFramesWithTiming(ctx, bytes.NewReader(data[p.end:]), d.full.migration, j, replay, details)
			return e
		})
		if err != nil {
			return out, err
		}
		var payload []byte
		err = phases.measure("suffixEncode", func() error {
			var e error
			// Prepared mode includes private normalization and the independent public
			// byte copy in this encoding phase; these are not free publication work.
			if d.preparedNative {
				payload, prepared, e = d.encodePreparedPrefixSnapshotWithTiming(next, phases)
			} else {
				payload, e = encodeCommittedStateJSON(next)
			}
			return e
		})
		if err != nil {
			return out, err
		}
		out.BlockJournalReadback = BlockJournalReadback{State: next, SnapshotJSON: payload, CompleteBytes: int(j.io.end), IncompleteTail: j.io.end < int64(len(data)), ReplayedBlocks: j.blocks - p.blocks, ReplayedTransactionInputs: j.replayedTxInputs}
		out.ReusedPrefixBytes = p.end
		logicalBlocks = j.blocks
	} else {
		var full BlockJournalReadback
		err := phases.measure("fullReplay", func() error { var e error; full, e = d.full.Decode(ctx, data); return e })
		if err != nil {
			return out, err
		}
		out.BlockJournalReadback = full
		logicalBlocks = full.ReplayedBlocks
	}
	if err := ctx.Err(); err != nil {
		return BlockJournalPrefixReadback{}, err
	}
	// Never cache failures or caller-owned objects. Older captures cannot displace
	// a newer validated state. Rotation at equal/newer height can replace it.
	if len(out.SnapshotJSON) <= d.ByteLimit() && (p == nil || out.State.Height >= p.height) {
		err := phases.measure("certificatePublish", func() error {
			certificate, err := d.makePrefixCertificateWithPrepared(data, out.BlockJournalReadback, logicalBlocks, phases, prepared)
			if err != nil {
				return err
			}
			d.prefix = certificate
			return nil
		})
		if err != nil {
			return BlockJournalPrefixReadback{}, err
		}
	}
	return out, nil
}

// The caller publishes only a fully constructed certificate. Failed strict JSON
// normalization must leave the prior private certificate/high-water untouched.
func (d *BlockJournalPrefixDecoder) makePrefixCertificate(data []byte, out BlockJournalReadback, logicalBlocks int, phases *BlockJournalPrefixWorkPhases) (*blockJournalPrefix, error) {
	return d.makePrefixCertificateWithPrepared(data, out, logicalBlocks, phases, nil)
}

// The prepared object can only come from this call's private suffix encode.
// The public byte result remains independently owned. Arbitrary callers using
// the original method above always retain original strict JSON reconstruction.
func (d *BlockJournalPrefixDecoder) makePrefixCertificateWithPrepared(data []byte, out BlockJournalReadback, logicalBlocks int, phases *BlockJournalPrefixWorkPhases, prepared *preparedCanonicalNativeSnapshot) (*blockJournalPrefix, error) {
	if prepared != nil && (!d.preparedNative || !d.nativeClone || d.canonicalNative || !bytes.Equal(prepared.payload, out.SnapshotJSON) || prepared.state.Height != out.State.Height || prepared.state.AppHash != out.State.AppHash || prepared.state.Initialized != out.State.Initialized) {
		return nil, errors.New("prepared prefix snapshot producer identity differs")
	}

	var certificate *blockJournalPrefix
	err := phases.measureCertificate("payloadCopy", func() error {
		var payload []byte
		if prepared != nil {
			payload = prepared.payload
		} else {
			payload = append([]byte(nil), out.SnapshotJSON...)
		}
		certificate = &blockJournalPrefix{payload: payload, digest: sha256.Sum256(data[:out.CompleteBytes]), end: out.CompleteBytes, blocks: logicalBlocks, height: out.State.Height}
		if phases != nil && phases.CertificatePublishDetails != nil {
			phases.CertificatePublishDetails.PayloadBytes += uint64(len(out.SnapshotJSON))
			phases.CertificatePublishDetails.PrefixBytesHashed += uint64(out.CompleteBytes)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if d.nativeClone {
		// Preserve the original strict JSON normalization semantics and private
		// clone. Every reused result still performs the original full Validate.
		var canonical CommittedState
		canonicalReady := false
		if prepared != nil {
			canonical, canonicalReady = prepared.state, true
			if phases != nil && phases.CertificatePublishDetails != nil {
				phases.CertificatePublishDetails.PreparedNativeAccepted++
			}
		}
		if d.canonicalNative {
			if err := phases.measureCertificate("canonicalNative", func() error {
				private, ok := cloneCanonicalNativeCommittedState(out.State)
				if !ok {
					return nil
				}
				// Bind the copied object to the exact independently encoded payload.
				// Any mismatch retains original strict JSON behavior and errors.
				encoded, err := encodeCommittedStateJSON(private)
				if err != nil || !bytes.Equal(encoded, certificate.payload) {
					return nil
				}
				canonical, canonicalReady = private, true
				if phases != nil && phases.CertificatePublishDetails != nil {
					phases.CertificatePublishDetails.CanonicalNativeAccepted++
				}
				return nil
			}); err != nil {
				return nil, err
			}
		}
		ownedStrict := false
		if !canonicalReady {
			if err := phases.measureCertificate("strictJSON", func() error {
				var err error
				canonical, ownedStrict, err = decodeOwnedNativeCertificate(certificate.payload, out.State)
				return err
			}); err != nil {
				return nil, err
			}
		}
		if err := phases.measureCertificate("nativeClone", func() error {
			private, ok := canonical, canonicalReady || ownedStrict
			if ownedStrict {
				copyNativeAccountLots(&private)
			}
			if !ok {
				private, ok = cloneNativeCommittedState(canonical)
			}
			if ok {
				certificate.native = &private
				certificate.payloadDigest = sha256.Sum256(certificate.payload)
				certificate.nativeAppHash = canonical.AppHash
				certificate.nativeInitialized = canonical.Initialized
			}
			return nil
		}); err != nil {
			return nil, err
		}
	}
	return certificate, nil
}

// VerificationStats reports only the original bounded native mathematical facts;
// prefix reuse does not manufacture new signature verifications.
func (d *BlockJournalPrefixDecoder) VerificationStats() BlockJournalVerificationStats {
	if d == nil || d.full == nil {
		return BlockJournalVerificationStats{}
	}
	return d.full.VerificationStats()
}
