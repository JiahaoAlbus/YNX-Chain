package participation

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"strconv"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// Review is read-only local handoff DATA, not Wallet's original pending review
// or permission. Exact ACTION/v1 bytes/hash do not replace its current policy.
type Review struct {
	Version                 string                  `json:"version"`
	Entry                   Entry                   `json:"entry"`
	PayloadBinding          Binding                 `json:"payloadBinding"`
	CanonicalAction         []byte                  `json:"canonicalAction,omitempty"`
	CanonicalActionSHA256   string                  `json:"canonicalActionSHA256,omitempty"`
	WalletInput             *WalletPreparationInput `json:"walletInput,omitempty"`
	WalletHandoffState      string                  `json:"walletHandoffState"`
	Current                 *Conditions             `json:"current,omitempty"`
	ConditionStatus         string                  `json:"conditionStatus"`
	WalletAdapterConfigured bool                    `json:"walletAdapterConfigured"`
	RequiresWalletApproval  bool                    `json:"requiresWalletApproval"`
	OriginalEffectMayExist  bool                    `json:"originalEffectMayExist"`
	LocalDispatchCancelled  bool                    `json:"localDispatchCancelled"`
	Authority               bool                    `json:"authority"`
	IndependentFinality     bool                    `json:"independentFinality"`
}

// These are the exact DATA keys reported by original Main's internal prepare
// contract. No account, network, nonce, review ID or permission is supplied by
// this projection. Its existence does not create an external Main transport;
// current Main refuses staking before review with its protected-witness gate.
type WalletPreparationInput struct {
	Kind    string                   `json:"kind"`
	Fee     string                   `json:"fee"`
	Payload WalletPreparationPayload `json:"payload"`
}
type WalletPreparationPayload struct {
	Validator    string `json:"validator,omitempty"`
	DelegationID string `json:"delegationID,omitempty"`
	UnbondingID  string `json:"unbondingID,omitempty"`
	AmountYNXT   string `json:"amountYNXT,omitempty"`
}

// Review reads the retained exact intent even when Wallet is absent. For a
// live local entry it compares current original RPC conditions without writing
// the journal, looking up Wallet, signing, publishing or refreshing an intent.
func (s *Service) Review(ctx context.Context, id string) (Review, error) {
	if ctx == nil {
		return Review{}, ErrInvalid
	}
	s.mu.Lock()
	entry, ok := s.data.Entries[id]
	if !ok {
		s.mu.Unlock()
		return Review{}, ErrInvalid
	}
	entry = cloneEntry(entry)
	result := Review{Version: "YNX-NETWORK-PARTICIPATION-REVIEW/v1", Entry: entry,
		PayloadBinding: bind(entry.Intent.CanonicalPayload), RequiresWalletApproval: true,
		WalletAdapterConfigured: s.wallet != nil, OriginalEffectMayExist: entry.PublishAttemptedAt != "",
		LocalDispatchCancelled: entry.CancelRequestedAt != "", ConditionStatus: entry.State}
	result.WalletHandoffState = "NOT_SUPPLIED"
	if s.wallet != nil {
		result.WalletHandoffState = "ADAPTER_CONFIGURED"
	}
	if entry.Intent.ActionKind != "" {
		message, err := originalActionMessage(entry.Intent)
		if err != nil {
			s.mu.Unlock()
			return result, err
		}
		result.CanonicalAction = message
		digest := sha256.Sum256(message)
		result.CanonicalActionSHA256 = hex.EncodeToString(digest[:])
		result.WalletInput = &WalletPreparationInput{Kind: entry.Intent.ActionKind, Fee: entry.Intent.Conditions.FeeYNXT,
			Payload: WalletPreparationPayload{Validator: entry.Intent.Request.Validator, DelegationID: entry.Intent.Request.DelegationID, UnbondingID: entry.Intent.Request.UnbondingID, AmountYNXT: entry.Intent.Request.AmountYNXT}}
	}
	if s.closed || s.persistErr != nil || s.lock.Check() != nil {
		s.mu.Unlock()
		result.ConditionStatus = "UNAVAILABLE"
		return result, ErrUnavailable
	}
	if entry.State != Prepared && entry.State != Unsupported {
		s.mu.Unlock()
		return result, nil
	}
	if s.data.Stopped || entry.Intent.Generation != strconv.FormatUint(s.data.Generation, 10) {
		s.mu.Unlock()
		return result, ErrRevoked
	}
	s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return result, err
	}
	if expiry, err := time.Parse(time.RFC3339Nano, entry.Intent.Request.ExpiresAt); err != nil || !time.Now().Before(expiry) {
		result.ConditionStatus = "EXPIRED"
		return result, nil
	}
	fresh, err := s.reader.Current(ctx, entry.Intent.Request)
	if err != nil {
		result.ConditionStatus = "UNAVAILABLE"
		return result, err
	}
	result.Current = &fresh
	if fresh.Network != entry.Intent.Network || fresh.Owner != entry.Intent.Request.Owner || fresh.Action != entry.Intent.Request.Action {
		result.ConditionStatus = "INVALID"
		return result, ErrInvalid
	}
	if bind(encoded(critical(fresh))) != bind(encoded(critical(entry.Intent.Conditions))) {
		result.ConditionStatus = "STALE"
		return result, ErrStale
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	latest := s.data.Entries[id]
	if s.closed || s.persistErr != nil || s.lock.Check() != nil {
		result.ConditionStatus = "UNAVAILABLE"
		return result, ErrUnavailable
	}
	if latest.State != entry.State || latest.CancelRequestedAt != entry.CancelRequestedAt || s.data.Stopped || latest.Intent.Generation != strconv.FormatUint(s.data.Generation, 10) {
		result.Entry = cloneEntry(latest)
		result.LocalDispatchCancelled = latest.CancelRequestedAt != ""
		result.OriginalEffectMayExist = latest.PublishAttemptedAt != ""
		result.ConditionStatus = latest.State
		return result, ErrStale
	}
	result.ConditionStatus = "CURRENT_RPC_REPORTED"
	return result, nil
}

// Reuse the original ACTION/v1 encoder. This supplies DATA only; the original
// Wallet owns current policy, review ID, private consent, custody and publish.
func originalActionMessage(intent Intent) ([]byte, error) {
	network, err := hex.DecodeString(intent.Network.NetworkID32)
	if err != nil || len(network) != 32 {
		return nil, ErrInvalid
	}
	chain, ec := integer(intent.Network.NativeChainID)
	nonce, en := integer(intent.Conditions.NextNonce)
	fee, ef := integer(intent.Conditions.FeeYNXT)
	kind, rawPayload, ep := payload(intent.Request)
	if ec != nil || en != nil || ef != nil || ep != nil || chain == 0 || chain > math.MaxInt64 || nonce == 0 || kind != intent.ActionKind || bind(rawPayload) != bind(intent.CanonicalPayload) {
		return nil, ErrInvalid
	}
	action := ynxauth.Action{ChainID: network, NativeChainID: chain, Owner: intent.Request.Owner,
		Nonce: nonce, Fee: fee, Kind: kind, Payload: rawPayload}
	message, err := action.SigningBytes()
	if err != nil {
		return nil, ErrInvalid
	}
	return message, nil
}
