//go:build pay_pq

package paynativesource

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"slices"
	"strconv"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	cmtmath "github.com/cometbft/cometbft/libs/math"
)

// Private Go projection of sole SDK dbd7f226's formal mapping, not a second
// crypto/approval codec or public grant constructor. Production decodes only
// after the original SDK Root/profile/current runner succeeds.
const originalPaySourcePurpose = "pay-native-cloud-bill-source-v1"
const originalPaySelectionKey = "payNativeCloudBillV1"

func requireOriginalPayFamily(r originalPayRelease) error {
	if r.purpose == "" || r.selectionKey == "" {
		return errors.New("PAY_ORIGINAL_FAMILY_NOT_SUPPLIED")
	}
	if r.purpose != originalPaySourcePurpose || r.selectionKey != originalPaySelectionKey {
		return errors.New("PAY_ORIGINAL_FAMILY_MISMATCH")
	}
	return nil
}

type originalPaySelection struct {
	Version  string `json:"version"`
	Bindings []struct {
		Service    string              `json:"service"`
		Principal  string              `json:"principal"`
		PeerUID    uint32              `json:"peerUID"`
		PeerPID    int                 `json:"peerPID"`
		Operations []string            `json:"operations"`
		Routes     map[string][]string `json:"routes"`
		UntilMS    int64               `json:"untilMs"`
		Bills      []struct {
			IntentOriginal    string                            `json:"intentOriginal"`
			ProductMerchantID string                            `json:"productMerchantID"`
			Terms             payproduct.NativeInvoiceTermsData `json:"terms"`
			Operations        []string                          `json:"operations"`
			UntilMS           int64                             `json:"untilMs"`
			CloudOriginal     originalCloudBillLocator          `json:"cloudOriginal"`
		} `json:"bills"`
		Submissions map[string]int64 `json:"submissions"`
	} `json:"bindings"`
	Anchor struct {
		Path             string `json:"path"`
		SHA256           string `json:"sha256"`
		ChainID          string `json:"chainId"`
		TrustingPeriodMS int64  `json:"trustingPeriodMs"`
		MaxClockDriftMS  int64  `json:"maxClockDriftMs"`
		TrustNumerator   uint64 `json:"trustNumerator"`
		TrustDenominator uint64 `json:"trustDenominator"`
	} `json:"anchor"`
}

var originalPayOperations = []string{"create", "read", "lookup", "merchant_review", "submit_merchant_member", "reconcile", "prepare_terms", "register_terms", "review_settlement", "settle", "review_refund", "refund"}

func operationsValid(operations []string) bool {
	if len(operations) == 0 || len(operations) > len(originalPayOperations) {
		return false
	}
	seen := map[string]bool{}
	for _, op := range operations {
		if !slices.Contains(originalPayOperations, op) || seen[op] {
			return false
		}
		seen[op] = true
	}
	return true
}
func canonicalU64(v string, positive bool) (uint64, error) {
	n, e := strconv.ParseUint(v, 10, 64)
	if e != nil || strconv.FormatUint(n, 10) != v || positive && n == 0 {
		return 0, ErrDenied
	}
	return n, nil
}
func termsFromOriginal(d payproduct.NativeInvoiceTermsData) (ynxauth.InvoiceTermsPayload, error) {
	p := ynxauth.InvoiceTermsPayload{InvoiceID: d.InvoiceID, SessionID: d.SessionID, Recipient: d.Recipient, Payer: d.Payer, AssetID: d.AssetID, UnitVersion: d.UnitVersion, FeeRule: d.FeeRule}
	var e error
	for _, v := range []struct {
		input string
		out   *uint64
	}{{d.KeyEpoch, &p.KeyEpoch}, {d.Revision, &p.Revision}, {d.AmountAtoms, &p.Amount}, {d.MaxFeeAtoms, &p.MaxFee}, {d.ExpiresAtHeight, &p.ExpiresAt}} {
		*v.out, e = canonicalU64(v.input, true)
		if e != nil {
			return p, e
		}
	}
	if p.AssetID != "YNXT" || p.UnitVersion != "1" || p.FeeRule != "native-transfer-fee-one/v1" || p.MaxFee != ynxauth.InvoiceActionFee || p.Amount > math.MaxInt64-ynxauth.InvoiceActionFee {
		return p, ErrDenied
	}
	_, e = ynxauth.EncodeActionPayload(ynxauth.ActionInvoiceTerms, p)
	return p, e
}
func assembleOriginalPayRuntime(resources OriginalNativePayResources, r originalPayRelease, projection map[string]json.RawMessage, selection json.RawMessage, lease *originalPayCommissioning) (*commissionedRuntime, error) {
	if lease == nil || lease.current() != nil {
		return nil, ErrDenied
	}
	data, subject, generation, e := decodeOriginalPayProjectionDATA(r, projection, selection)
	if e != nil {
		return nil, e
	}
	engine, e := selectOriginalPayEngine(resources)
	if e != nil {
		return nil, e
	}
	if engine.engine != r.engine {
		return nil, ErrPayEngineResources
	}
	runtime := &commissionedRuntime{genesis: slices.Clone(r.genesis), nativeID: r.nativeID, ledger: &originalLedger{node: engine.native, genesis: slices.Clone(r.genesis), nativeID: r.nativeID, engine: engine}, bindings: make(map[string]*originalServiceBinding), store: resources.PayStore, cloudBills: resources.CloudBills}
	runtime.generation.Store(generation)
	runtime.nodeOrigin = r.nodeOrigin
	runtime.engine = engine.engine
	now := time.Now()
	for _, entry := range data.Bindings {
		until := time.UnixMilli(entry.UntilMS)
		if entry.Service == "" || entry.Principal != subject || entry.PeerUID == 0 || entry.PeerPID <= 0 || !operationsValid(entry.Operations) || !now.Before(until) || until.After(lease.until) || len(entry.Routes) == 0 || len(entry.Bills) == 0 {
			return nil, ErrDenied
		}
		if _, exists := runtime.bindings[entry.Service]; exists {
			return nil, ErrDenied
		}
		binding := &originalServiceBinding{service: entry.Service, principal: entry.Principal, uid: entry.PeerUID, pid: entry.PeerPID, operations: slices.Clone(entry.Operations), until: until, bills: make(map[string]*originalBill), generation: generation, routes: make(map[string][]string), submissions: make(map[string]time.Time)}
		for route, ops := range entry.Routes {
			if route == "" || !operationsValid(ops) {
				return nil, ErrDenied
			}
			for _, op := range ops {
				if !slices.Contains(binding.operations, op) {
					return nil, ErrDenied
				}
			}
			binding.routes[route] = slices.Clone(ops)
		}
		for hash, ms := range entry.Submissions {
			decoded, e := hex.DecodeString(hash)
			u := time.UnixMilli(ms)
			if e != nil || len(decoded) != 32 || hex.EncodeToString(decoded) != hash || !now.Before(u) || u.After(until) {
				return nil, ErrDenied
			}
			binding.submissions[hash] = u
		}
		for _, record := range entry.Bills {
			var intent payproduct.NativeInvoiceProductIntent
			if len(record.IntentOriginal) == 0 || len(record.IntentOriginal) > 131072 || decodeObject([]byte(record.IntentOriginal), &intent) != nil || !operationsValid(record.Operations) || intent.Genesis != hex.EncodeToString(r.genesis) || intent.NativeChainID != strconv.FormatUint(r.nativeID, 10) || intent.SourceOrder == "" || !accountaddress.IsCanonical(intent.Merchant) || record.ProductMerchantID == "" {
				return nil, ErrDenied
			}
			terms, e := termsFromOriginal(record.Terms)
			if e != nil || terms.Recipient != intent.Recipient || terms.AssetID != intent.AssetID || terms.UnitVersion != intent.UnitVersion || strconv.FormatUint(terms.Amount, 10) != intent.AmountAtoms || intent.ProductID == "shop.order" && intent.StoreID == "" {
				return nil, ErrDenied
			}
			u := time.UnixMilli(record.UntilMS)
			if !now.Before(u) || u.After(until) || len(intent.DomainData) == 0 || len(intent.DomainData) > 65536 {
				return nil, ErrDenied
			}
			for _, op := range record.Operations {
				if !slices.Contains(binding.operations, op) {
					return nil, ErrDenied
				}
			}
			if _, exists := binding.bills[intent.SourceOrder]; exists {
				return nil, ErrDenied
			}
			if intent.ProductID != "cloud.ide-usage" || record.CloudOriginal.Owner == "" || record.CloudOriginal.RequestID == "" || record.CloudOriginal.Period == "" {
				return nil, errors.New("PAY_ORIGINAL_CLOUD_BILL_MAPPING_NOT_SUPPLIED")
			}
			binding.bills[intent.SourceOrder] = &originalBill{intent: cloneIntent(intent), productMerchantID: record.ProductMerchantID, merchant: intent.Merchant, storeID: intent.StoreID, terms: terms, readerPrincipal: subject, operations: slices.Clone(record.Operations), until: u, generation: generation, cloudOriginal: record.CloudOriginal}
		}
		runtime.bindings[binding.service] = binding
	}
	// Native Devnet has no Comet quorum/H+1 trust. Keep the signed anchor field
	// as the formal mapping, but never open/claim it as native-engine proof.
	if engine.engine == OriginalPayNativeEngine {
		runtime.proof = &originalProofReader{engine: engine}
		return runtime, lease.current()
	}
	a := data.Anchor
	if a.ChainID == "" || a.TrustingPeriodMS <= 0 || a.MaxClockDriftMS < 0 || a.TrustingPeriodMS > int64((365*24*time.Hour)/time.Millisecond) || a.TrustNumerator == 0 || a.TrustDenominator == 0 || a.TrustNumerator > a.TrustDenominator {
		return nil, ErrDenied
	}
	anchorRaw, e := lease.hold(a.Path, a.SHA256, consensus.MaxPQTrustedLightBlockBytes)
	if e != nil {
		return nil, e
	}
	anchor, e := consensus.DecodePQTrustedLightBlock(anchorRaw)
	if e != nil || anchor.ChainID != a.ChainID {
		return nil, ErrDenied
	}
	runtime.proof = &originalProofReader{engine: engine, nativeID: r.nativeID, authenticatedAnchor: anchor, trustingPeriod: time.Duration(a.TrustingPeriodMS) * time.Millisecond, maxDrift: time.Duration(a.MaxClockDriftMS) * time.Millisecond, trustLevel: cmtmath.Fraction{Numerator: a.TrustNumerator, Denominator: a.TrustDenominator}, chainID: a.ChainID, genesis: slices.Clone(r.genesis)}
	return runtime, lease.current()
}

// Normal assembly's actual typed projection intake. The original SDK already
// verified the signature/platform/full-scope semantics. This private DATA
// decode does not acquire an owner, registration, proof anchor or permission.
func decodeOriginalPayProjectionDATA(r originalPayRelease, projection map[string]json.RawMessage, selection json.RawMessage) (originalPaySelection, string, uint64, error) {
	var data originalPaySelection
	if e := requireOriginalPayFamily(r); e != nil {
		return data, "", 0, e
	}
	var selected map[string]json.RawMessage
	if json.Unmarshal(selection, &selected) != nil {
		return data, "", 0, ErrDenied
	}
	raw, exists := selected[originalPaySelectionKey]
	if !exists {
		return data, "", 0, errors.New("PAY_SOLE_SDK_SIGNED_SELECTION_NOT_SUPPLIED")
	}
	if decodeObject(raw, &data) != nil || data.Version != "1" || len(data.Bindings) == 0 || len(data.Bindings) > 64 {
		return data, "", 0, errors.New("PAY_SOLE_SDK_SIGNED_SELECTION_CONTRACT_MISMATCH")
	}
	var subject string
	var generation uint64
	if json.Unmarshal(projection["subjectOwner"], &subject) != nil || !accountaddress.IsCanonical(subject) || json.Unmarshal(projection["generation"], &generation) != nil || generation == 0 {
		return data, "", 0, ErrDenied
	}
	return data, subject, generation, nil
}
