package yusdsandbox

import "time"

const (
	SchemaVersion     = 1
	Decimals          = 6
	AccountDailyLimit = uint64(100_000_000_000)
	GlobalDailyLimit  = uint64(1_000_000_000_000)
)

type Config struct {
	StatePath string
	APIKey    string
	Now       func() time.Time
}
type MutationRequest struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Amount         uint64 `json:"amount"`
	Account        string `json:"account,omitempty"`
	EvidenceHash   string `json:"evidenceHash"`
}
type ProviderRequest struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Status         string `json:"status"`
	EvidenceHash   string `json:"evidenceHash"`
}
type PauseRequest struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Paused         bool   `json:"paused"`
	EvidenceHash   string `json:"evidenceHash"`
}
type Redemption struct {
	ID           string     `json:"id"`
	Account      string     `json:"account"`
	Amount       uint64     `json:"amount"`
	Status       string     `json:"status"`
	RequestedAt  time.Time  `json:"requestedAt"`
	CompletedAt  *time.Time `json:"completedAt,omitempty"`
	EvidenceHash string     `json:"evidenceHash"`
}
type AuditEvent struct {
	Sequence     uint64    `json:"sequence"`
	At           time.Time `json:"at"`
	Action       string    `json:"action"`
	ObjectID     string    `json:"objectId"`
	EvidenceHash string    `json:"evidenceHash"`
	PreviousHash string    `json:"previousHash"`
	Hash         string    `json:"hash"`
}
type Snapshot struct {
	SchemaVersion           int       `json:"schemaVersion"`
	Product                 string    `json:"product"`
	Network                 string    `json:"network"`
	Symbol                  string    `json:"symbol"`
	Decimals                int       `json:"decimals"`
	Source                  string    `json:"source"`
	AsOf                    time.Time `json:"asOf"`
	Version                 int       `json:"version"`
	ReserveUnits            uint64    `json:"reserveUnits"`
	SupplyUnits             uint64    `json:"supplyUnits"`
	PendingRedemptionUnits  uint64    `json:"pendingRedemptionUnits"`
	RequiredBackingUnits    uint64    `json:"requiredBackingUnits"`
	ExcessReserveUnits      uint64    `json:"excessReserveUnits"`
	Solvent                 bool      `json:"solvent"`
	Reconciled              bool      `json:"reconciled"`
	Paused                  bool      `json:"paused"`
	ProviderStatus          string    `json:"providerStatus"`
	ProviderOutage          bool      `json:"providerOutage"`
	RealityValue            bool      `json:"realityValue"`
	ExternalReserveAttested bool      `json:"externalReserveAttested"`
	GuaranteedPeg           bool      `json:"guaranteedPeg"`
	AccountDailyLimit       uint64    `json:"accountDailyLimit"`
	GlobalDailyLimit        uint64    `json:"globalDailyLimit"`
	Failure                 bool      `json:"failure"`
}
type MutationResult[T any] struct {
	Record   T    `json:"record"`
	Replayed bool `json:"replayed"`
}
