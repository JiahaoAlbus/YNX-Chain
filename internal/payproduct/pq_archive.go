//go:build pay_pq

package payproduct

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

var ErrNativePayOriginalArchiveUnavailable = errors.New("NATIVE_PAY_SETTLEMENT_ARCHIVE_UNAVAILABLE")

// Preserve the normal Core proof limit plus bounded original/anchor overhead.
const NativePayOriginalArchiveMaxBytes = consensus.MaxPQTransactionProofRequestBytes + (16 << 20)

func freezeNativeArchiveVerificationInput(trust consensus.PQLightProofTrust, expected consensus.PQTransactionProofExpectation, proof consensus.PQTransactionProofRequest) (consensus.PQLightProofTrust, consensus.PQTransactionProofExpectation, consensus.PQTransactionProofRequest, error) {
	// Verify and archive exactly the same owned bytes. Keep the genuine held
	// engine snapshot; a serialized snapshot cannot manufacture its authority.
	input := struct {
		Expected consensus.PQTransactionProofExpectation
		Proof    consensus.PQTransactionProofRequest
	}{expected, proof}
	raw, err := json.Marshal(input)
	if err != nil || len(raw) > NativePayOriginalArchiveMaxBytes {
		return trust, expected, proof, errors.New("bounded original verification inputs required")
	}
	if err = strictJSON(raw, &input); err != nil {
		return trust, expected, proof, err
	}
	anchor, err := cmtjson.Marshal(trust.TrustedLightBlock)
	if err != nil {
		return trust, expected, proof, err
	}
	var original cmttypes.LightBlock
	if trust.TrustedLightBlock == nil || cmtjson.Unmarshal(anchor, &original) != nil {
		return trust, expected, proof, errors.New("original verified trust anchor required")
	}
	trust.TrustedLightBlock = &original
	return trust, input.Expected, input.Proof, nil
}

// Public historical verification DATA, not a Wallet signing review, private
// payer journal, current account snapshot, Source grant or reusable trust root.
// Only Reconcile creates this after the normal independent verifier succeeds.
type NativePayOriginalArchive struct {
	Version           string                                  `json:"version"`
	Digest            string                                  `json:"digest"`
	Genesis           string                                  `json:"genesis"`
	NativeChainID     uint64                                  `json:"nativeChainId,string"`
	ProductMerchantID string                                  `json:"productMerchantId,omitempty"`
	SourceOrder       string                                  `json:"sourceOrder"`
	SessionID         string                                  `json:"sessionId"`
	TermsHash         string                                  `json:"termsHash"`
	TermsMessage      []byte                                  `json:"termsMessage"`
	Original          NativePayOriginal                       `json:"original"`
	Kind              string                                  `json:"kind"`
	Owner             string                                  `json:"owner"`
	Status            string                                  `json:"status"`
	EventClaim        string                                  `json:"eventClaim,omitempty"`
	Effect            *consensus.PQInvoiceEffect              `json:"effect,omitempty"`
	Expected          consensus.PQTransactionProofExpectation `json:"expected"`
	Proof             consensus.PQTransactionProofRequest     `json:"proof"`
	Verified          consensus.PQTransactionProofResult      `json:"verified"`
	TrustedLightBlock json.RawMessage                         `json:"trustedLightBlock"`
	VerifiedAt        time.Time                               `json:"verifiedAt"`
	Authority         string                                  `json:"authority"`
}

func nativeArchiveDigest(a NativePayOriginalArchive) string { a.Digest = ""; return hashJSON(a) }
func (n *NativePayService) nativeArchiveSlot(merchant, id, hash string) string {
	return hashJSON([]string{"YNX_PAY_NATIVE_ORIGINALS_V1", hex.EncodeToString(n.cfg.Genesis), merchant, id, hash})
}

func (n *NativePayService) appendOriginalArchive(data *Snapshot, state *NativePayInvoice, op NativePayOperation, a NativePayOriginalArchive) error {
	if err := n.validateOriginalArchive(*state, op, a); err != nil {
		return err
	}
	slot := n.nativeArchiveSlot(state.Merchant, state.InvoiceID, op.NativeHash)
	if _, exists := data.BusinessDispatches[slot]; exists {
		return errors.New("native original archive is append-only")
	}
	raw, err := json.Marshal(a)
	if err != nil || len(raw) > NativePayOriginalArchiveMaxBytes {
		return errors.New("bounded native original archive cannot be stored")
	}
	data.BusinessDispatches[slot] = BusinessDispatchRecord{MerchantID: state.Merchant, Operation: "native.originals", RequestHash: a.Digest, Phase: "retained", ResultCipher: n.parent.seal(string(raw)), UpdatedAt: n.parent.now().UTC()}
	if state.OriginalArchives == nil {
		state.OriginalArchives = map[string]string{}
	}
	state.OriginalArchives[op.NativeHash] = a.Digest
	return nil
}

func (n *NativePayService) captureOriginalArchive(state NativePayInvoice, op NativePayOperation, trust consensus.PQLightProofTrust, expected consensus.PQTransactionProofExpectation, proof consensus.PQTransactionProofRequest, verified consensus.PQTransactionProofResult) (NativePayOriginalArchive, error) {
	terms, err := ynxbatch.DecodeMember(state.Operations[state.TermsOperation].Member)
	if err != nil {
		return NativePayOriginalArchive{}, err
	}
	anchor, err := cmtjson.Marshal(trust.TrustedLightBlock)
	if err != nil {
		return NativePayOriginalArchive{}, err
	}
	a := NativePayOriginalArchive{Version: "ynx.pay.native.originals/v1", Genesis: hex.EncodeToString(n.cfg.Genesis), NativeChainID: n.cfg.NativeChainID, ProductMerchantID: state.ProductMerchantID, SourceOrder: state.SourceOrder, SessionID: state.SessionID, TermsHash: state.TermsHash, TermsMessage: bytes.Clone(terms.Message), Original: op.NativePayOriginal, Kind: op.Kind, Owner: op.Owner, Status: op.Status, Effect: op.Effect, Expected: expected, Proof: proof, Verified: verified, TrustedLightBlock: anchor, VerifiedAt: n.parent.now().UTC(), Authority: "original-core-independent-verifier/public-historical-data"}
	if a.Effect != nil {
		a.EventClaim = nativeEventClaim(*a.Effect)
	}
	// Detach every proof/expectation slice from mutable transport/Source buffers.
	raw, err := json.Marshal(a)
	if err != nil || len(raw) > NativePayOriginalArchiveMaxBytes {
		return NativePayOriginalArchive{}, errors.New("native originals exceed bounded archive")
	}
	if err = strictJSON(raw, &a); err != nil {
		return a, err
	}
	a.Digest = nativeArchiveDigest(a)
	return a, n.validateOriginalArchive(state, op, a)
}

func (n *NativePayService) validateOriginalArchive(state NativePayInvoice, op NativePayOperation, a NativePayOriginalArchive) error {
	bad := errors.New("native historical originals archive requires recovery")
	terms, err := ynxbatch.DecodeMember(state.Operations[state.TermsOperation].Member)
	if err != nil {
		return bad
	}
	digest := sha256.Sum256(a.TermsMessage)
	if a.Version != "ynx.pay.native.originals/v1" || a.Authority != "original-core-independent-verifier/public-historical-data" || a.Digest != nativeArchiveDigest(a) || a.Genesis != hex.EncodeToString(n.cfg.Genesis) || a.NativeChainID != n.cfg.NativeChainID || a.ProductMerchantID != state.ProductMerchantID || a.SourceOrder != state.SourceOrder || a.SessionID != state.SessionID || a.TermsHash != state.TermsHash || hex.EncodeToString(digest[:]) != state.TermsHash || !bytes.Equal(a.TermsMessage, terms.Message) || a.Original.Merchant != state.Merchant || a.Original.InvoiceID != state.InvoiceID || a.Original.NativeHash != op.NativeHash || a.Original.ABCIHash != op.ABCIHash || !bytes.Equal(a.Original.Member, op.Member) || !bytes.Equal(a.Original.Envelope, op.Envelope) || a.Kind != op.Kind || a.Owner != op.Owner || a.Status != op.Status || !a.Verified.Finalized || !a.Verified.Included || a.Verified.NativeGrant || a.VerifiedAt.IsZero() || len(a.TrustedLightBlock) == 0 {
		return bad
	}
	if consensus.SignedTransactionHash(a.Original.Member) != op.NativeHash || consensus.SignedTransactionHash(a.Original.Envelope) != op.ABCIHash || !bytes.Equal(a.Expected.NativeWire, op.Member) || !bytes.Equal(a.Expected.Envelope, op.Envelope) || "0x"+a.Verified.NativeWireHash != op.NativeHash || "0x"+a.Verified.TransactionHash != op.ABCIHash {
		return bad
	}
	if a.Status == "confirmed" {
		effect, err := consensus.ValidatePQInvoiceEffectData(op.Member, op.Envelope, uint64(a.Verified.Height), a.Verified.ExecutionData)
		if err != nil || !a.Verified.ExecutionSuccessful || a.Verified.ExecutionCode != 0 || a.Effect == nil || op.Effect == nil || hashJSON(effect) != hashJSON(*a.Effect) || hashJSON(a.Effect) != hashJSON(op.Effect) || a.EventClaim != nativeEventClaim(effect) {
			return bad
		}
	} else if a.Status != "confirmed_failed" || a.Effect != nil || op.Effect != nil || a.EventClaim != "" || a.Verified.ExecutionSuccessful || a.Verified.ExecutionCode == 0 {
		return bad
	}
	return nil
}

// Same original operation, fresh existing invoice-read authority, no network,
// reconstruction, backfill, signing, journal mutation or outbox wakeup.
func (n *NativePayService) ReadOriginalArchive(ctx context.Context, merchant, id, nativeHash string) (NativePayOriginalArchive, error) {
	state, grant, err := n.readInvoiceWithGrant(ctx, merchant, id)
	if err != nil {
		return NativePayOriginalArchive{}, err
	}
	op, found := state.Operations[nativeHash]
	if !found {
		return NativePayOriginalArchive{}, ErrNativePayOriginalArchiveUnavailable
	}
	digest, found := state.OriginalArchives[nativeHash]
	if !found {
		return NativePayOriginalArchive{}, ErrNativePayOriginalArchiveUnavailable
	}
	var a NativePayOriginalArchive
	err = n.parent.store.View(func(data Snapshot) error {
		if err := n.fence(ctx, grant); err != nil {
			return err
		}
		record, found := data.BusinessDispatches[n.nativeArchiveSlot(merchant, id, nativeHash)]
		if !found || record.Operation != "native.originals" || record.Phase != "retained" || record.MerchantID != merchant || record.RequestHash != digest {
			return errors.New("native original archive reference requires recovery")
		}
		raw, err := n.parent.open(record.ResultCipher)
		if err != nil {
			return err
		}
		if err = strictJSON([]byte(raw), &a); err != nil {
			return err
		}
		if a.Digest != digest {
			return errors.New("native archive digest differs from original reference")
		}
		return n.validateOriginalArchive(state, op, a)
	})
	if err != nil {
		return NativePayOriginalArchive{}, err
	}
	if err = n.fence(ctx, grant); err != nil {
		return NativePayOriginalArchive{}, err
	}
	return a, nil
}
