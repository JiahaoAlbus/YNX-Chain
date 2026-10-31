// Package participation consumes the original governance/staking read APIs and
// owns only a local durable Wallet handoff/outbox. It neither signs nor submits
// chain transactions. A genuine original Wallet publisher adapter is required.
package participation

import (
	"context"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"golang.org/x/crypto/sha3"
)

var (
	ErrUnsupported = errors.New("UNSUPPORTED: required original capability not supplied")
	ErrInvalid     = errors.New("INVALID: exact participation binding required")
	ErrConflict    = errors.New("CONFLICT: semantic slot already bound")
	ErrRevoked     = errors.New("REVOKED: local generation no longer authorizes new dispatch")
	ErrStale       = errors.New("STALE: authoritative conditions changed")
	ErrUnknown     = errors.New("UNKNOWN: reconcile original operation only")
	ErrUnavailable = errors.New("UNAVAILABLE: configured read authority unavailable")
)

const (
	Vote              = "vote"
	Delegate          = "delegate"
	Unbond            = "unbond"
	Prepared          = "PREPARED"
	Unsupported       = "UNSUPPORTED"
	Unknown           = "UNKNOWN"
	AwaitingWallet    = "AWAITING_WALLET"
	ReportedCommitted = "RPC_REPORTED_COMMITTED"
	ReportedRejected  = "RPC_REPORTED_REJECTED"
	Denied            = "DENIED"
	Revoked           = "REVOKED"
)

type Binding struct {
	Bytes   string `json:"bytes"`
	SHA3512 string `json:"sha3_512"`
	SHA512  string `json:"sha512"`
}

func bind(v []byte) Binding {
	a, b := sha3.Sum512(v), sha512.Sum512(v)
	return Binding{strconv.Itoa(len(v)), hex.EncodeToString(a[:]), hex.EncodeToString(b[:])}
}
func encoded(v any) []byte { b, _ := json.Marshal(v); return b }

type Network struct {
	Genesis       string `json:"genesis"`
	NetworkID32   string `json:"networkId32"`
	NativeChainID string `json:"nativeChainId"`
	CometChainID  string `json:"cometChainId"`
}
type Request struct {
	RequestID    string `json:"requestId"`
	Owner        string `json:"owner"`
	Action       string `json:"action"`
	Proposal     string `json:"proposal,omitempty"`
	Choice       string `json:"choice,omitempty"`
	Validator    string `json:"validator,omitempty"`
	DelegationID string `json:"delegationId,omitempty"`
	AmountYNXT   string `json:"amountYnxt,omitempty"`
	FeeCapYNXT   string `json:"feeCapYnxt"`
	ExpiresAt    string `json:"expiresAt"`
}

// Conditions retain exact current source facts. Registry eligibility is never
// promoted into native snapshot eligibility. No balances are persisted here.
type Conditions struct {
	Network             Network `json:"network"`
	Source              string  `json:"source"`
	Owner               string  `json:"owner"`
	Action              string  `json:"action"`
	NativeAvailable     bool    `json:"nativeAvailable"`
	Reason              string  `json:"reason,omitempty"`
	PolicyRevision      string  `json:"policyRevision,omitempty"`
	NextNonce           string  `json:"nextNonce,omitempty"`
	ObservedHeight      string  `json:"observedHeight,omitempty"`
	FeeYNXT             string  `json:"feeYnxt,omitempty"`
	FeeSource           string  `json:"feeSource,omitempty"`
	Validator           string  `json:"validator,omitempty"`
	ObjectVersion       string  `json:"objectVersion,omitempty"`
	AvailableYNXT       string  `json:"availableYnxt,omitempty"`
	UnbondingSeconds    string  `json:"unbondingSeconds,omitempty"`
	CommissionBPS       string  `json:"commissionBps,omitempty"`
	Proposal            string  `json:"proposal,omitempty"`
	ProposalBinding     Binding `json:"proposalBinding"`
	ReportedVotingPower string  `json:"reportedVotingPower,omitempty"`
	SnapshotHeight      string  `json:"snapshotHeight,omitempty"`
	VotingEndsAt        string  `json:"votingEndsAt,omitempty"`
	ObservedAt          string  `json:"observedAt"`
}

// Intent is an internal product handoff, NOT a new SDK or signed wire schema.
// Payload is encoded by the existing ynxauth.EncodeActionPayload implementation.
// The original Wallet must show and bind these exact bytes before approval.
type Intent struct {
	Network          Network    `json:"network"`
	Request          Request    `json:"request"`
	Conditions       Conditions `json:"conditions"`
	ActionKind       string     `json:"actionKind,omitempty"`
	CanonicalPayload []byte     `json:"canonicalPayload,omitempty"`
	Generation       string     `json:"generation"`
}
type WalletCapabilities struct {
	Publisher                   string
	Network                     Network
	Suite                       string
	Actions                     []string
	PublishOriginalNativeAction bool
	LookupOriginalOperation     bool
}
type WalletResult struct {
	OperationID string  `json:"operationId"`
	Intent      Binding `json:"intent"`
	State       string  `json:"state"`
	NativeHash  string  `json:"nativeHash,omitempty"`
	RemoteRef   string  `json:"remoteRef,omitempty"`
}

// Wallet is supplied only by the original publisher owner. There is no default
// HTTP publisher or guessed SDK method in this package. Publish must approve /
// sign once with operationID, Lookup must never sign, send or replace a request.
type Wallet interface {
	Capabilities(context.Context) (WalletCapabilities, error)
	Publish(context.Context, string, Intent, Binding) (WalletResult, error)
	Lookup(context.Context, string, Binding) (WalletResult, error)
}
type Observation struct {
	Status              string  `json:"status"`
	NativeHash          string  `json:"nativeHash"`
	ABCIHash            string  `json:"abciHash,omitempty"`
	ExecutionHeight     string  `json:"executionHeight,omitempty"`
	Source              string  `json:"source"`
	WireBinding         Binding `json:"wireBinding"`
	EffectsBinding      Binding `json:"effectsBinding"`
	IndependentFinality bool    `json:"independentFinality"`
}
type Reader interface {
	Current(context.Context, Request) (Conditions, error)
	ReadResult(context.Context, Intent, string) (Observation, error)
}
type UnbondingCondition struct {
	ID                string `json:"id"`
	Owner             string `json:"owner"`
	Validator         string `json:"validator"`
	AmountYNXT        string `json:"amountYnxt"`
	Status            string `json:"status"`
	AvailableAt       string `json:"availableAt"`
	ReportedChainTime string `json:"reportedChainTime"`
	WithdrawAvailable bool   `json:"withdrawAvailable"`
	Source            string `json:"source"`
}
type Entry struct {
	ID                 string        `json:"id"`
	Slot               string        `json:"slot"`
	Guard              string        `json:"guard"`
	Intent             Intent        `json:"intent"`
	Binding            Binding       `json:"binding"`
	BusinessBinding    Binding       `json:"businessBinding"`
	State              string        `json:"state"`
	BlockedReason      string        `json:"blockedReason,omitempty"`
	PublishAttemptedAt string        `json:"publishAttemptedAt,omitempty"`
	WalletResult       *WalletResult `json:"walletResult,omitempty"`
	Observation        *Observation  `json:"observation,omitempty"`
	LastError          string        `json:"lastError,omitempty"`
	FirstCause         string        `json:"firstCause,omitempty"`
	CreatedAt          string        `json:"createdAt"`
	UpdatedAt          string        `json:"updatedAt"`
}

func timestamp() string { return time.Now().UTC().Format(time.RFC3339Nano) }
