package resourcemarket

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productstore"
)

const (
	reservationLedgerSchemaVersion = 6
	SchemaVersion                  = 7
)

const maxInt64Value int64 = 1<<63 - 1

var errAmountOutOfRange = errors.New("monetary amount exceeds supported int64 range")

func checkedAddNonNegative(a, b int64) (int64, bool) {
	if a < 0 || b < 0 || a > maxInt64Value-b {
		return 0, false
	}
	return a + b, true
}

func checkedMulNonNegative(a, b int64) (int64, bool) {
	if a < 0 || b < 0 {
		return 0, false
	}
	if a == 0 || b == 0 {
		return 0, true
	}
	if a > maxInt64Value/b {
		return 0, false
	}
	return a * b, true
}

func checkedProRataNonNegative(value, numerator, denominator int64) (int64, bool) {
	if value < 0 || numerator < 0 || denominator <= 0 || numerator > denominator {
		return 0, false
	}
	whole, remainder := value/denominator, value%denominator
	wholeShare, ok := checkedMulNonNegative(whole, numerator)
	if !ok {
		return 0, false
	}
	remainderProduct, ok := checkedMulNonNegative(remainder, numerator)
	if !ok {
		return 0, false
	}
	return checkedAddNonNegative(wholeShare, remainderProduct/denominator)
}

var ResourceUnits = map[string]string{
	"storage": "gib-hour", "bandwidth_egress": "gib", "cpu_compute": "vcpu-second",
	"gpu_compute": "gpu-second", "ai_inference": "token", "developer_build": "build-minute",
	"quant_backtest": "worker-second", "paper_shadow_worker": "worker-second",
	"indexer_rpc": "request", "artifact_storage": "gib-hour",
}

type Source struct {
	Kind       string    `json:"kind"`
	URI        string    `json:"uri,omitempty"`
	AsOf       time.Time `json:"asOf"`
	Version    string    `json:"version"`
	Confidence float64   `json:"confidence,omitempty"`
	Coverage   string    `json:"coverage,omitempty"`
	Status     string    `json:"status"`
}

type Provider struct {
	ID                  string           `json:"id"`
	Wallet              string           `json:"wallet"`
	Name                string           `json:"name"`
	Region              string           `json:"region"`
	Status              string           `json:"status"`
	Hardware            []string         `json:"hardware"`
	Evidence            []string         `json:"evidence"`
	Capacity            map[string]int64 `json:"capacity"`
	Reserved            map[string]int64 `json:"reserved"`
	Uptime              float64          `json:"uptime"`
	CompletionRate      float64          `json:"completionRate"`
	SecurityBond        int64            `json:"securityBond"`
	BondAvailable       int64            `json:"bondAvailable"`
	FailureCount        int              `json:"failureCount"`
	DisputeCount        int              `json:"disputeCount"`
	Maintenance         bool             `json:"maintenance"`
	MaintenanceEvidence string           `json:"maintenanceEvidence,omitempty"`
	ExitEvidence        string           `json:"exitEvidence,omitempty"`
	MigrationTarget     string           `json:"migrationTarget,omitempty"`
	Source              Source           `json:"source"`
	CreatedAt           time.Time        `json:"createdAt"`
	UpdatedAt           time.Time        `json:"updatedAt"`
	WorkerKeyIDs        []string         `json:"workerKeyIds"`
}

type WorkerKey struct {
	ID         string     `json:"id"`
	ProviderID string     `json:"providerId"`
	Algorithm  string     `json:"algorithm"`
	PublicKey  string     `json:"publicKey"`
	Status     string     `json:"status"`
	Source     Source     `json:"source"`
	CreatedAt  time.Time  `json:"createdAt"`
	ExpiresAt  time.Time  `json:"expiresAt"`
	RevokedAt  *time.Time `json:"revokedAt,omitempty"`
}

type Offer struct {
	ID                string    `json:"id"`
	ProviderID        string    `json:"providerId"`
	Resource          string    `json:"resource"`
	Unit              string    `json:"unit"`
	Pricing           string    `json:"pricing"`
	Currency          string    `json:"currency"`
	Status            string    `json:"status"`
	UnitPrice         int64     `json:"unitPrice"`
	Capacity          int64     `json:"capacity"`
	ReservedUnits     int64     `json:"reservedUnits"`
	MinUnits          int64     `json:"minUnits"`
	MaxUnits          int64     `json:"maxUnits"`
	SLAUptime         float64   `json:"slaUptime"`
	LatencyMS         int64     `json:"latencyMs"`
	CommitmentSeconds int64     `json:"commitmentSeconds"`
	Source            Source    `json:"source"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
	ExpiresAt         time.Time `json:"expiresAt"`
}

type Quote struct {
	ID           string    `json:"id"`
	Buyer        string    `json:"buyer"`
	OfferID      string    `json:"offerId"`
	AuctionID    string    `json:"auctionId,omitempty"`
	AuctionBidID string    `json:"auctionBidId,omitempty"`
	ProviderID   string    `json:"providerId"`
	Resource     string    `json:"resource"`
	Unit         string    `json:"unit"`
	Currency     string    `json:"currency"`
	Status       string    `json:"status"`
	Units        int64     `json:"units"`
	UnitPrice    int64     `json:"unitPrice"`
	ProviderCost int64     `json:"providerCost"`
	ProtocolFee  int64     `json:"protocolFee"`
	GrossCost    int64     `json:"grossCost"`
	Source       Source    `json:"source"`
	CreatedAt    time.Time `json:"createdAt"`
	ExpiresAt    time.Time `json:"expiresAt"`
}

type Auction struct {
	ID             string    `json:"id"`
	Buyer          string    `json:"buyer"`
	Mode           string    `json:"mode"`
	Resource       string    `json:"resource"`
	Unit           string    `json:"unit"`
	Region         string    `json:"region,omitempty"`
	Currency       string    `json:"currency"`
	Status         string    `json:"status"`
	Units          int64     `json:"units"`
	MaxUnitPrice   int64     `json:"maxUnitPrice"`
	ProtocolFeeBPS int64     `json:"protocolFeeBps"`
	Source         Source    `json:"source"`
	CreatedAt      time.Time `json:"createdAt"`
	ClosesAt       time.Time `json:"closesAt"`
	ClearedAt      time.Time `json:"clearedAt,omitempty"`
	QuoteIDs       []string  `json:"quoteIds"`
}

type AuctionBid struct {
	ID               string    `json:"id"`
	AuctionID        string    `json:"auctionId"`
	ProviderID       string    `json:"providerId"`
	OfferID          string    `json:"offerId"`
	Status           string    `json:"status"`
	Units            int64     `json:"units"`
	AllocatedUnits   int64     `json:"allocatedUnits"`
	UnitPrice        int64     `json:"unitPrice"`
	CommitmentDigest string    `json:"commitmentDigest"`
	Source           Source    `json:"source"`
	CreatedAt        time.Time `json:"createdAt"`
}

type AuctionClearing struct {
	Auction Auction      `json:"auction"`
	Quotes  []Quote      `json:"quotes"`
	Bids    []AuctionBid `json:"bids"`
}

type ErasureRequest struct {
	ID          string    `json:"id"`
	Subject     string    `json:"subject"`
	Status      string    `json:"status"`
	Reason      string    `json:"reason"`
	Source      Source    `json:"source"`
	RequestedAt time.Time `json:"requestedAt"`
	FulfilledAt time.Time `json:"fulfilledAt,omitempty"`
	FulfilledBy string    `json:"fulfilledBy,omitempty"`
}

type RetentionReport struct {
	PolicyVersion         string    `json:"policyVersion"`
	ExpiredQuotesDeleted  int       `json:"expiredQuotesDeleted"`
	FailedAuctionsDeleted int       `json:"failedAuctionsDeleted"`
	RejectedBidsDeleted   int       `json:"rejectedBidsDeleted"`
	AppliedAt             time.Time `json:"appliedAt"`
}

type Order struct {
	ID                  string    `json:"id"`
	Buyer               string    `json:"buyer"`
	ProviderID          string    `json:"providerId"`
	QuoteID             string    `json:"quoteId"`
	Resource            string    `json:"resource"`
	Unit                string    `json:"unit"`
	Status              string    `json:"status"`
	Units               int64     `json:"units"`
	ReservedUnits       int64     `json:"reservedUnits"`
	IntentDigest        string    `json:"intentDigest"`
	RetryOfOrderID      string    `json:"retryOfOrderId,omitempty"`
	RetryOrderID        string    `json:"retryOrderId,omitempty"`
	ReservationEvidence string    `json:"reservationEvidence,omitempty"`
	ServiceEvidence     string    `json:"serviceEvidence,omitempty"`
	MeterIDs            []string  `json:"meterIds"`
	AuditIDs            []string  `json:"auditIds"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type Meter struct {
	ID                string    `json:"id"`
	OrderID           string    `json:"orderId"`
	Buyer             string    `json:"buyer"`
	ProviderID        string    `json:"providerId"`
	Resource          string    `json:"resource"`
	Unit              string    `json:"unit"`
	IntegrityEvidence string    `json:"integrityEvidence"`
	Status            string    `json:"status"`
	Start             time.Time `json:"start"`
	End               time.Time `json:"end"`
	Quantity          int64     `json:"quantity"`
	Rate              int64     `json:"rate"`
	GrossCost         int64     `json:"grossCost"`
	ProviderNet       int64     `json:"providerNet"`
	ProtocolFee       int64     `json:"protocolFee"`
	Source            Source    `json:"source"`
	WorkerKeyID       string    `json:"workerKeyId"`
	Signature         string    `json:"signature"`
}

type MeterSigningPayload struct {
	SchemaVersion int    `json:"schemaVersion"`
	OrderID       string `json:"orderId"`
	Buyer         string `json:"buyer"`
	ProviderID    string `json:"providerId"`
	Resource      string `json:"resource"`
	Unit          string `json:"unit"`
	Start         string `json:"start"`
	End           string `json:"end"`
	Quantity      int64  `json:"quantity"`
	Rate          int64  `json:"rate"`
	Source        Source `json:"source"`
}

type MeterSigningRequest struct {
	Payload         MeterSigningPayload `json:"payload"`
	CanonicalJSON   string              `json:"canonicalJson"`
	SHA256          string              `json:"sha256"`
	Algorithm       string              `json:"algorithm"`
	IntegrityFormat string              `json:"integrityFormat"`
}

type Receipt struct {
	ID              string    `json:"id"`
	OrderID         string    `json:"orderId"`
	Asset           string    `json:"asset"`
	TransactionHash string    `json:"transactionHash"`
	Evidence        string    `json:"evidence"`
	Status          string    `json:"status"`
	GrossCost       int64     `json:"grossCost"`
	ProviderNet     int64     `json:"providerNet"`
	ProtocolFee     int64     `json:"protocolFee"`
	Refund          int64     `json:"refund"`
	Source          Source    `json:"source"`
	ConfirmedAt     time.Time `json:"confirmedAt"`
}

type Dispute struct {
	ID             string    `json:"id"`
	OrderID        string    `json:"orderId"`
	OpenedBy       string    `json:"openedBy"`
	Reason         string    `json:"reason"`
	Evidence       string    `json:"evidence"`
	Status         string    `json:"status"`
	Decision       string    `json:"decision,omitempty"`
	Reviewer       string    `json:"reviewer,omitempty"`
	Penalty        int64     `json:"penalty"`
	Refund         int64     `json:"refund"`
	AppealBy       string    `json:"appealBy,omitempty"`
	AppealReason   string    `json:"appealReason,omitempty"`
	AppealEvidence string    `json:"appealEvidence,omitempty"`
	AppealDecision string    `json:"appealDecision,omitempty"`
	NoticeAt       time.Time `json:"noticeAt"`
	AppealUntil    time.Time `json:"appealUntil,omitempty"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type Audit struct {
	ID      string    `json:"id"`
	Actor   string    `json:"actor"`
	Action  string    `json:"action"`
	Target  string    `json:"target"`
	Outcome string    `json:"outcome"`
	At      time.Time `json:"at"`
}

type state struct {
	Version         int                       `json:"version"`
	Sequence        uint64                    `json:"sequence"`
	Providers       map[string]Provider       `json:"providers"`
	Offers          map[string]Offer          `json:"offers"`
	Quotes          map[string]Quote          `json:"quotes"`
	Orders          map[string]Order          `json:"orders"`
	Meters          map[string]Meter          `json:"meters"`
	Receipts        map[string]Receipt        `json:"receipts"`
	Disputes        map[string]Dispute        `json:"disputes"`
	WorkerKeys      map[string]WorkerKey      `json:"workerKeys"`
	Auctions        map[string]Auction        `json:"auctions"`
	AuctionBids     map[string]AuctionBid     `json:"auctionBids"`
	ErasureRequests map[string]ErasureRequest `json:"erasureRequests"`
	Audit           []Audit                   `json:"audit"`
}

type Engine struct {
	mu   sync.Mutex
	path string
	now  func() time.Time
	data state
}

func New(path string, now func() time.Time) (*Engine, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("market store path is required")
	}
	if now == nil {
		now = time.Now
	}
	e := &Engine{path: path, now: now, data: emptyState()}
	var loaded state
	legacyEnvelope, err := productstore.Load(path, &loaded)
	if err != nil {
		return nil, fmt.Errorf("load market store: %w", err)
	} else if loaded.Version != 0 {
		if loaded.Version < 1 || loaded.Version > SchemaVersion {
			return nil, fmt.Errorf("unsupported market schema version %d", loaded.Version)
		}
		loadedVersion := loaded.Version
		e.data = loaded
		e.ensureMaps()
		reservationMigrated, err := e.reconcileReservationLedger(loadedVersion)
		if err != nil {
			return nil, fmt.Errorf("validate market reservation ledger: %w", err)
		}
		retryMigrated, err := e.reconcileRetryLineage(loadedVersion)
		if err != nil {
			return nil, fmt.Errorf("validate market retry lineage: %w", err)
		}
		if legacyEnvelope || reservationMigrated || retryMigrated {
			if err := e.save(); err != nil {
				return nil, fmt.Errorf("persist market schema migration: %w", err)
			}
		}
	}
	e.ensureMaps()
	return e, nil
}

// RestoreBackup validates the exact market schema and integrity envelope before
// replacing the primary store. Operators must preserve incident copies before
// invoking it.
func RestoreBackup(path string) error {
	var candidate state
	if err := productstore.RestoreBackup(path, &candidate); err != nil {
		return err
	}
	if candidate.Version < 1 || candidate.Version > SchemaVersion {
		return fmt.Errorf("unsupported restored market schema version %d", candidate.Version)
	}
	return nil
}

func emptyState() state {
	return state{Version: SchemaVersion, Providers: map[string]Provider{}, Offers: map[string]Offer{}, Quotes: map[string]Quote{}, Orders: map[string]Order{}, Meters: map[string]Meter{}, Receipts: map[string]Receipt{}, Disputes: map[string]Dispute{}, WorkerKeys: map[string]WorkerKey{}, Auctions: map[string]Auction{}, AuctionBids: map[string]AuctionBid{}, ErasureRequests: map[string]ErasureRequest{}}
}
func (e *Engine) ensureMaps() {
	if e.data.Providers == nil {
		e.data.Providers = map[string]Provider{}
	}
	if e.data.Offers == nil {
		e.data.Offers = map[string]Offer{}
	}
	if e.data.Quotes == nil {
		e.data.Quotes = map[string]Quote{}
	}
	if e.data.Orders == nil {
		e.data.Orders = map[string]Order{}
	}
	if e.data.Meters == nil {
		e.data.Meters = map[string]Meter{}
	}
	if e.data.Receipts == nil {
		e.data.Receipts = map[string]Receipt{}
	}
	if e.data.Disputes == nil {
		e.data.Disputes = map[string]Dispute{}
	}
	if e.data.WorkerKeys == nil {
		e.data.WorkerKeys = map[string]WorkerKey{}
	}
	if e.data.Auctions == nil {
		e.data.Auctions = map[string]Auction{}
	}
	if e.data.AuctionBids == nil {
		e.data.AuctionBids = map[string]AuctionBid{}
	}
	if e.data.ErasureRequests == nil {
		e.data.ErasureRequests = map[string]ErasureRequest{}
	}
}

func reservationHoldsCapacity(status string) bool {
	switch status {
	case "capacity_reserved", "service_started", "metered_usage", "service_completed", "settlement_pending":
		return true
	default:
		return false
	}
}

func equalInt64Ledger(actual, expected map[string]int64) bool {
	for key, value := range actual {
		if value != expected[key] {
			return false
		}
	}
	for key, value := range expected {
		if value != actual[key] {
			return false
		}
	}
	return true
}

// reconcileReservationLedger upgrades pre-v6 snapshots by deriving exact
// offer-scoped and provider-scoped reservation totals from active orders. Once
// a snapshot is v6, any mismatch is treated as semantic tampering and startup
// fails closed rather than silently repairing authoritative capacity state.
func (e *Engine) reconcileReservationLedger(fromVersion int) (bool, error) {
	expectedOfferReserved := make(map[string]int64, len(e.data.Offers))
	expectedProviderCapacity := make(map[string]map[string]int64, len(e.data.Providers))
	expectedProviderReserved := make(map[string]map[string]int64, len(e.data.Providers))
	for providerID, provider := range e.data.Providers {
		if provider.ID != "" && provider.ID != providerID {
			return false, errors.New("provider ID does not match reservation ledger key")
		}
		for _, value := range provider.Capacity {
			if value < 0 {
				return false, errors.New("provider capacity ledger cannot be negative")
			}
		}
		for _, value := range provider.Reserved {
			if value < 0 {
				return false, errors.New("provider reservation ledger cannot be negative")
			}
		}
		expectedProviderCapacity[providerID] = map[string]int64{}
		expectedProviderReserved[providerID] = map[string]int64{}
	}
	for offerID, offer := range e.data.Offers {
		if offer.ID != "" && offer.ID != offerID {
			return false, errors.New("offer ID does not match reservation ledger key")
		}
		if offer.Capacity <= 0 || offer.ReservedUnits < 0 {
			return false, errors.New("offer capacity ledger must be positive and non-negative")
		}
		if _, ok := e.data.Providers[offer.ProviderID]; !ok {
			return false, errors.New("offer reservation ledger references missing provider")
		}
		current := expectedProviderCapacity[offer.ProviderID][offer.Resource]
		if offer.Capacity > maxInt64Value-current {
			return false, errors.New("provider capacity ledger overflow")
		}
		expectedProviderCapacity[offer.ProviderID][offer.Resource] = current + offer.Capacity
	}
	for orderID, order := range e.data.Orders {
		if order.ID != "" && order.ID != orderID {
			return false, errors.New("order ID does not match reservation ledger key")
		}
		if !reservationHoldsCapacity(order.Status) {
			if fromVersion >= reservationLedgerSchemaVersion && order.ReservedUnits != 0 {
				return false, errors.New("terminal or unreserved order retained capacity")
			}
			if fromVersion < reservationLedgerSchemaVersion && order.ReservedUnits != 0 {
				order.ReservedUnits = 0
				e.data.Orders[orderID] = order
			}
			continue
		}
		if order.ReservedUnits <= 0 || order.ReservedUnits > order.Units {
			return false, errors.New("active order has invalid reserved capacity")
		}
		quote, quoteOK := e.data.Quotes[order.QuoteID]
		offer, offerOK := e.data.Offers[quote.OfferID]
		if !quoteOK || !offerOK || quote.ProviderID != order.ProviderID || offer.ProviderID != order.ProviderID || quote.Resource != order.Resource || offer.Resource != order.Resource || quote.Unit != order.Unit || offer.Unit != order.Unit {
			return false, errors.New("active order reservation lineage is incomplete or mismatched")
		}
		currentOffer := expectedOfferReserved[offer.ID]
		if currentOffer > offer.Capacity-order.ReservedUnits {
			return false, errors.New("active orders exceed exact offer capacity")
		}
		expectedOfferReserved[offer.ID] = currentOffer + order.ReservedUnits
		currentProvider := expectedProviderReserved[order.ProviderID][order.Resource]
		providerCapacity := expectedProviderCapacity[order.ProviderID][order.Resource]
		if currentProvider > providerCapacity-order.ReservedUnits {
			return false, errors.New("active orders exceed provider capacity")
		}
		expectedProviderReserved[order.ProviderID][order.Resource] = currentProvider + order.ReservedUnits
	}

	if fromVersion < reservationLedgerSchemaVersion {
		for offerID, offer := range e.data.Offers {
			offer.ReservedUnits = expectedOfferReserved[offerID]
			e.data.Offers[offerID] = offer
		}
		for providerID, provider := range e.data.Providers {
			provider.Capacity = expectedProviderCapacity[providerID]
			provider.Reserved = expectedProviderReserved[providerID]
			e.data.Providers[providerID] = provider
		}
		e.data.Version = reservationLedgerSchemaVersion
		return true, nil
	}
	for offerID, offer := range e.data.Offers {
		if offer.ReservedUnits != expectedOfferReserved[offerID] {
			return false, errors.New("offer reservation ledger does not match active orders")
		}
	}
	for providerID, provider := range e.data.Providers {
		if !equalInt64Ledger(provider.Capacity, expectedProviderCapacity[providerID]) {
			return false, errors.New("provider capacity ledger does not match offers")
		}
		if !equalInt64Ledger(provider.Reserved, expectedProviderReserved[providerID]) {
			return false, errors.New("provider reservation ledger does not match active orders")
		}
	}
	return false, nil
}

func retryLineageMatches(failed, retry Order) bool {
	return failed.Buyer == retry.Buyer &&
		failed.ProviderID == retry.ProviderID &&
		failed.QuoteID == retry.QuoteID &&
		failed.Resource == retry.Resource &&
		failed.Unit == retry.Unit &&
		failed.Units == retry.Units &&
		failed.IntentDigest == retry.IntentDigest &&
		!retry.CreatedAt.Before(failed.CreatedAt)
}

// reconcileRetryLineage upgrades pre-v7 snapshots using only existing
// failure_retry audit events. It never invents a retry. Ambiguous, duplicate or
// chained legacy retries fail closed for operator review. Version 7 snapshots
// must preserve a one-to-one failed-order -> retry-order relationship.
func (e *Engine) reconcileRetryLineage(fromVersion int) (bool, error) {
	retryAuditIDs := make(map[string][]string)
	for _, audit := range e.data.Audit {
		if audit.Action != "failure_retry" {
			continue
		}
		if audit.ID == "" || audit.Target == "" {
			return false, errors.New("failure retry audit is missing identity or target")
		}
		retryAuditIDs[audit.Target] = append(retryAuditIDs[audit.Target], audit.ID)
	}

	if fromVersion < SchemaVersion {
		retryIDs := make([]string, 0, len(retryAuditIDs))
		for retryID := range retryAuditIDs {
			retryIDs = append(retryIDs, retryID)
		}
		sort.Strings(retryIDs)
		for _, retryID := range retryIDs {
			retry, ok := e.data.Orders[retryID]
			if !ok {
				return false, errors.New("legacy failure retry audit references missing order")
			}
			if retry.RetryOfOrderID != "" {
				continue
			}
			candidateIDs := make([]string, 0, 1)
			for failedID, failed := range e.data.Orders {
				if failedID == retryID || failed.Status != "provider_failed" || failed.RetryOfOrderID != "" || failed.RetryOrderID != "" {
					continue
				}
				if len(retryAuditIDs[failedID]) != 0 || !retryLineageMatches(failed, retry) {
					continue
				}
				candidateIDs = append(candidateIDs, failedID)
			}
			sort.Strings(candidateIDs)
			if len(candidateIDs) != 1 {
				return false, errors.New("legacy failure retry lineage is missing or ambiguous")
			}
			failed := e.data.Orders[candidateIDs[0]]
			failed.RetryOrderID = retry.ID
			retry.RetryOfOrderID = failed.ID
			e.data.Orders[failed.ID] = failed
			e.data.Orders[retry.ID] = retry
		}
	}

	claimedFailedOrders := make(map[string]string)
	for orderID, order := range e.data.Orders {
		if order.ID != "" && order.ID != orderID {
			return false, errors.New("order ID does not match retry lineage key")
		}
		if order.RetryOfOrderID != "" && order.RetryOrderID != "" {
			return false, errors.New("retry order cannot create a chained retry")
		}
		if order.RetryOfOrderID == "" {
			if len(retryAuditIDs[orderID]) != 0 {
				return false, errors.New("failure retry audit is missing persisted source lineage")
			}
		} else {
			failed, ok := e.data.Orders[order.RetryOfOrderID]
			if !ok || failed.Status != "provider_failed" || failed.RetryOrderID != order.ID || !retryLineageMatches(failed, order) {
				return false, errors.New("failure retry lineage is incomplete or mismatched")
			}
			if len(retryAuditIDs[orderID]) != 1 {
				return false, errors.New("failure retry must have exactly one creation audit")
			}
			if existing, exists := claimedFailedOrders[failed.ID]; exists && existing != order.ID {
				return false, errors.New("failed order is linked to multiple retries")
			}
			claimedFailedOrders[failed.ID] = order.ID
		}
		if order.RetryOrderID != "" {
			retry, ok := e.data.Orders[order.RetryOrderID]
			if !ok || order.Status != "provider_failed" || retry.RetryOfOrderID != order.ID || !retryLineageMatches(order, retry) {
				return false, errors.New("failed order retry pointer is incomplete or mismatched")
			}
		}
	}
	for retryID, auditIDs := range retryAuditIDs {
		if len(auditIDs) != 1 {
			return false, errors.New("failure retry has duplicate creation audits")
		}
		retry := e.data.Orders[retryID]
		found := false
		for _, auditID := range retry.AuditIDs {
			if auditID == auditIDs[0] {
				found = true
				break
			}
		}
		if !found {
			return false, errors.New("failure retry audit is not bound to retry order")
		}
	}
	if fromVersion < SchemaVersion {
		e.data.Version = SchemaVersion
		return true, nil
	}
	return false, nil
}

func (e *Engine) next(prefix string) string {
	e.data.Sequence++
	return fmt.Sprintf("%s-%08d", prefix, e.data.Sequence)
}
func (e *Engine) audit(actor, action, target, outcome string) string {
	id := e.next("audit")
	e.data.Audit = append(e.data.Audit, Audit{id, actor, action, target, outcome, e.now().UTC()})
	return id
}
func (e *Engine) save() error { return productstore.Save(e.path, e.data) }
func validSource(s Source) bool {
	return s.Kind != "" && !s.AsOf.IsZero() && s.Version != "" && (s.Status == "available" || s.Status == "degraded" || s.Status == "unavailable")
}

func (e *Engine) RegisterProvider(actor string, p Provider) (Provider, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if actor == "" || p.Wallet != actor || p.Name == "" || p.Region == "" || len(p.Hardware) == 0 || !validSource(p.Source) {
		return Provider{}, errors.New("wallet-owned provider profile, region, hardware and evidence source are required")
	}
	if p.SecurityBond < 0 {
		return Provider{}, errors.New("security bond cannot be negative")
	}
	p.ID = e.next("provider")
	p.Status = "pending_verification"
	p.BondAvailable = p.SecurityBond
	p.Capacity = map[string]int64{}
	p.Reserved = map[string]int64{}
	p.CreatedAt = e.now().UTC()
	p.UpdatedAt = p.CreatedAt
	e.data.Providers[p.ID] = p
	e.audit(actor, "provider_register", p.ID, p.Status)
	return p, e.save()
}

func (e *Engine) VerifyProvider(reviewer, id string, evidence []string) (Provider, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	p, ok := e.data.Providers[id]
	if !ok {
		return Provider{}, errors.New("provider not found")
	}
	if reviewer == "" || reviewer == p.Wallet || len(evidence) == 0 {
		return Provider{}, errors.New("independent reviewer and verification evidence are required")
	}
	p.Evidence = append(p.Evidence, evidence...)
	p.Status = "verified"
	p.UpdatedAt = e.now().UTC()
	e.data.Providers[id] = p
	e.audit(reviewer, "provider_verify", id, "verified")
	return p, e.save()
}

// SetMaintenance prevents new matching and offers while preserving existing
// orders. Evidence makes both planned maintenance and recovery auditable.
func (e *Engine) SetMaintenance(providerWallet, id string, enabled bool, evidence string) (Provider, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	p, ok := e.data.Providers[id]
	if !ok || p.Wallet != providerWallet || p.Status != "verified" || strings.TrimSpace(evidence) == "" {
		return Provider{}, errors.New("verified provider ownership and maintenance evidence required")
	}
	p.Maintenance = enabled
	p.MaintenanceEvidence = evidence
	p.UpdatedAt = e.now().UTC()
	e.data.Providers[id] = p
	e.audit(providerWallet, "provider_maintenance", id, fmt.Sprintf("enabled=%t", enabled))
	return p, e.save()
}

// UpdateCapacity changes an offer's evidenced capacity without allowing the
// provider to reduce it below capacity already reserved by accepted work.
func (e *Engine) UpdateCapacity(providerWallet, offerID string, capacity, maxUnits int64, source Source) (Offer, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	o, ok := e.data.Offers[offerID]
	p := e.data.Providers[o.ProviderID]
	if !ok || p.Wallet != providerWallet || p.Status != "verified" || capacity <= 0 || capacity < o.ReservedUnits || maxUnits < o.MinUnits || maxUnits > capacity || !validSource(source) {
		return Offer{}, errors.New("provider-owned offer, evidenced capacity above reservations, and bounded maximum required")
	}
	delta := capacity - o.Capacity
	currentProviderCapacity := p.Capacity[o.Resource]
	if (delta > 0 && currentProviderCapacity > maxInt64Value-delta) || (delta < 0 && currentProviderCapacity < -delta) {
		return Offer{}, errors.New("provider capacity ledger cannot apply offer update")
	}
	p.Capacity[o.Resource] = currentProviderCapacity + delta
	p.UpdatedAt = e.now().UTC()
	o.Capacity, o.MaxUnits, o.Source, o.UpdatedAt = capacity, maxUnits, source, e.now().UTC()
	e.data.Providers[p.ID], e.data.Offers[o.ID] = p, o
	e.audit(providerWallet, "capacity_update", offerID, fmt.Sprintf("capacity=%d", capacity))
	return o, e.save()
}

// ExitProvider closes all offers and revokes worker keys only after every
// order is terminal and all reserved capacity has been released. A migration
// target is mandatory so customers have an explicit continuity path.
func (e *Engine) ExitProvider(providerWallet, id, evidence, migrationTarget string) (Provider, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	p, ok := e.data.Providers[id]
	if !ok || p.Wallet != providerWallet || p.Status != "verified" || strings.TrimSpace(evidence) == "" || strings.TrimSpace(migrationTarget) == "" {
		return Provider{}, errors.New("verified provider ownership, exit evidence and migration target required")
	}
	for _, units := range p.Reserved {
		if units != 0 {
			return Provider{}, errors.New("provider cannot exit with reserved capacity")
		}
	}
	for _, o := range e.data.Orders {
		if o.ProviderID == id && o.Status != "asset_settlement_confirmed" && o.Status != "provider_failed" && o.Status != "refunded" {
			return Provider{}, errors.New("provider cannot exit with non-terminal orders")
		}
	}
	now := e.now().UTC()
	p.Status, p.Maintenance, p.ExitEvidence, p.MigrationTarget, p.UpdatedAt = "exited", true, evidence, migrationTarget, now
	for offerID, offer := range e.data.Offers {
		if offer.ProviderID == id {
			offer.Status, offer.UpdatedAt = "closed_provider_exit", now
			e.data.Offers[offerID] = offer
		}
	}
	for keyID, key := range e.data.WorkerKeys {
		if key.ProviderID == id && key.Status == "active" {
			key.Status, key.RevokedAt = "revoked", &now
			e.data.WorkerKeys[keyID] = key
		}
	}
	e.data.Providers[id] = p
	e.audit(providerWallet, "provider_exit", id, "exited_with_migration")
	return p, e.save()
}

func (e *Engine) RegisterWorkerKey(providerWallet, providerID, keyID, publicKey string, expiresAt time.Time, source Source) (WorkerKey, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	p, ok := e.data.Providers[providerID]
	now := e.now().UTC()
	if !ok || p.Wallet != providerWallet || p.Status != "verified" {
		return WorkerKey{}, errors.New("verified provider ownership required")
	}
	if keyID == "" || len(keyID) > 128 || strings.Contains(keyID, ":") {
		return WorkerKey{}, errors.New("bounded worker key ID without colon required")
	}
	if _, exists := e.data.WorkerKeys[keyID]; exists {
		return WorkerKey{}, errors.New("worker key ID already exists")
	}
	decoded, err := base64.RawURLEncoding.DecodeString(publicKey)
	if err != nil || len(decoded) != ed25519.PublicKeySize {
		return WorkerKey{}, errors.New("Ed25519 public key must be 32-byte base64url")
	}
	if !expiresAt.After(now) || expiresAt.After(now.Add(366*24*time.Hour)) || !validSource(source) {
		return WorkerKey{}, errors.New("future bounded key expiry and evidence source required")
	}
	k := WorkerKey{ID: keyID, ProviderID: providerID, Algorithm: "Ed25519", PublicKey: publicKey, Status: "active", Source: source, CreatedAt: now, ExpiresAt: expiresAt.UTC()}
	e.data.WorkerKeys[keyID] = k
	p.WorkerKeyIDs = append(p.WorkerKeyIDs, keyID)
	p.UpdatedAt = now
	e.data.Providers[p.ID] = p
	e.audit(providerWallet, "worker_key_register", keyID, "active")
	return k, e.save()
}

func (e *Engine) RevokeWorkerKey(providerWallet, keyID string) (WorkerKey, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	k, ok := e.data.WorkerKeys[keyID]
	p := e.data.Providers[k.ProviderID]
	if !ok || p.Wallet != providerWallet || k.Status != "active" {
		return WorkerKey{}, errors.New("active provider-owned worker key required")
	}
	now := e.now().UTC()
	k.Status, k.RevokedAt = "revoked", &now
	e.data.WorkerKeys[keyID] = k
	e.audit(providerWallet, "worker_key_revoke", keyID, "revoked")
	return k, e.save()
}

func MeterPayloadJSON(order Order, quote Quote, start, end time.Time, quantity int64, source Source) ([]byte, error) {
	return json.Marshal(MeterSigningPayload{SchemaVersion: SchemaVersion, OrderID: order.ID, Buyer: order.Buyer, ProviderID: order.ProviderID, Resource: order.Resource, Unit: order.Unit, Start: start.UTC().Format(time.RFC3339Nano), End: end.UTC().Format(time.RFC3339Nano), Quantity: quantity, Rate: quote.UnitPrice, Source: source})
}

func (e *Engine) PrepareMeter(providerWallet, orderID string, start, end time.Time, quantity int64, source Source) (MeterSigningRequest, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	o, ok := e.data.Orders[orderID]
	p := e.data.Providers[o.ProviderID]
	q := e.data.Quotes[o.QuoteID]
	if !ok || p.Wallet != providerWallet || !validSource(source) {
		return MeterSigningRequest{}, errors.New("provider-owned active service, bounded interval, quantity and source required")
	}
	if _, _, err := e.validateMeterWindowLocked(o, start, end, quantity); err != nil {
		return MeterSigningRequest{}, err
	}
	raw, err := MeterPayloadJSON(o, q, start, end, quantity, source)
	if err != nil {
		return MeterSigningRequest{}, err
	}
	var payload MeterSigningPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return MeterSigningRequest{}, err
	}
	sum := sha256.Sum256(raw)
	return MeterSigningRequest{Payload: payload, CanonicalJSON: string(raw), SHA256: hex.EncodeToString(sum[:]), Algorithm: "Ed25519", IntegrityFormat: "ed25519:<workerKeyId>:<base64url-signature>"}, nil
}

func (e *Engine) serviceStartedAtLocked(order Order) (time.Time, bool) {
	for _, audit := range e.data.Audit {
		if audit.Target == order.ID && audit.Action == "service_started" {
			return audit.At.UTC(), true
		}
	}
	return time.Time{}, false
}

func (e *Engine) validateMeterWindowLocked(order Order, start, end time.Time, quantity int64) (int64, int64, error) {
	if order.Status != "service_started" && order.Status != "metered_usage" {
		return 0, 0, errors.New("active metered service required")
	}
	start, end = start.UTC(), end.UTC()
	serviceStartedAt, ok := e.serviceStartedAtLocked(order)
	if !ok || !end.After(start) || start.Before(serviceStartedAt) {
		return 0, 0, errors.New("meter interval must begin at or after evidenced service start")
	}
	var totalQuantity, totalFee int64
	for _, meterID := range order.MeterIDs {
		meter, exists := e.data.Meters[meterID]
		if !exists || meter.OrderID != order.ID {
			return 0, 0, errors.New("meter lineage is incomplete or mismatched")
		}
		if start.Before(meter.End) && end.After(meter.Start) {
			return 0, 0, errors.New("meter interval overlaps previously accepted usage")
		}
		var totalsOK bool
		totalQuantity, totalsOK = checkedAddNonNegative(totalQuantity, meter.Quantity)
		if !totalsOK {
			return 0, 0, errAmountOutOfRange
		}
		totalFee, totalsOK = checkedAddNonNegative(totalFee, meter.ProtocolFee)
		if !totalsOK {
			return 0, 0, errAmountOutOfRange
		}
	}
	if quantity <= 0 || totalQuantity > order.Units || quantity > order.Units-totalQuantity {
		return 0, 0, errors.New("cumulative metered quantity exceeds ordered units")
	}
	return totalQuantity, totalFee, nil
}

func (e *Engine) PublishOffer(actor string, o Offer) (Offer, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	p, ok := e.data.Providers[o.ProviderID]
	unit, resourceOK := ResourceUnits[o.Resource]
	if !ok || p.Wallet != actor || p.Status != "verified" || p.Maintenance {
		return Offer{}, errors.New("verified active provider ownership required")
	}
	if !resourceOK || o.Unit != unit || o.UnitPrice < 0 || o.Capacity <= 0 || o.MinUnits <= 0 || o.MaxUnits < o.MinUnits || o.MaxUnits > o.Capacity || o.Currency == "" || !validSource(o.Source) || !o.ExpiresAt.After(e.now()) {
		return Offer{}, errors.New("valid resource unit, bounded capacity, price, currency, source and expiry are required")
	}
	if o.Pricing != "fixed" && o.Pricing != "reverse_auction" && o.Pricing != "batch_auction" && o.Pricing != "reservation" && o.Pricing != "long_term" {
		return Offer{}, errors.New("unsupported pricing model")
	}
	if p.Capacity[o.Resource] > maxInt64Value-o.Capacity {
		return Offer{}, errors.New("provider capacity ledger overflow")
	}
	o.ID = e.next("offer")
	o.Status = "active"
	o.ReservedUnits = 0
	o.CreatedAt = e.now().UTC()
	o.UpdatedAt = o.CreatedAt
	e.data.Offers[o.ID] = o
	p.Capacity[o.Resource] += o.Capacity
	e.data.Providers[p.ID] = p
	e.audit(actor, "offer_publish", o.ID, "active")
	return o, e.save()
}

func score(p Provider, o Offer) float64 {
	return p.Uptime*25 + p.CompletionRate*20 + float64(p.BondAvailable)*0.001 - float64(o.UnitPrice)*0.01 - float64(o.LatencyMS)*0.001 - float64(p.FailureCount*5+p.DisputeCount*3)
}
func (e *Engine) Match(resource, region string, units int64) []Offer {
	e.mu.Lock()
	defer e.mu.Unlock()
	now := e.now()
	out := []Offer{}
	for _, o := range e.data.Offers {
		p := e.data.Providers[o.ProviderID]
		if p.Status == "verified" && !p.Maintenance && o.Status == "active" && o.Resource == resource && o.ExpiresAt.After(now) && units >= o.MinUnits && units <= o.MaxUnits && o.Capacity-o.ReservedUnits >= units && (region == "" || p.Region == region) {
			out = append(out, o)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		pi, pj := e.data.Providers[out[i].ProviderID], e.data.Providers[out[j].ProviderID]
		si, sj := score(pi, out[i]), score(pj, out[j])
		if si == sj {
			return out[i].UnitPrice < out[j].UnitPrice
		}
		return si > sj
	})
	return out
}

// CreateAuction opens an evidenced procurement window. Reverse auctions choose
// one provider for the entire demand; batch auctions may split demand across
// multiple providers. Neither mode reserves capacity or settles assets.
func (e *Engine) CreateAuction(buyer, mode, resource, region, currency string, units, maxUnitPrice, protocolFeeBPS int64, closesAt time.Time, source Source) (Auction, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	now := e.now().UTC()
	unit, ok := ResourceUnits[resource]
	if buyer == "" || (mode != "reverse_auction" && mode != "batch_auction") || !ok || currency == "" || units <= 0 || maxUnitPrice < 0 || protocolFeeBPS < 0 || protocolFeeBPS > 10_000 || closesAt.Before(now.Add(time.Minute)) || closesAt.After(now.Add(7*24*time.Hour)) || !validSource(source) {
		return Auction{}, errors.New("buyer, auction mode, supported resource, bounded demand, fee, close time and source required")
	}
	a := Auction{ID: e.next("auction"), Buyer: buyer, Mode: mode, Resource: resource, Unit: unit, Region: region, Currency: currency, Status: "open", Units: units, MaxUnitPrice: maxUnitPrice, ProtocolFeeBPS: protocolFeeBPS, Source: source, CreatedAt: now, ClosesAt: closesAt.UTC(), QuoteIDs: []string{}}
	e.data.Auctions[a.ID] = a
	e.audit(buyer, "auction_create", a.ID, mode)
	return a, e.save()
}

// SubmitAuctionBid records a provider's sealed procurement bid. Prices remain
// server-side until the auction closes; the commitment digest allows later
// verification that the clearing used the exact submitted terms.
func (e *Engine) SubmitAuctionBid(providerWallet, auctionID, offerID string, units, unitPrice int64, source Source) (AuctionBid, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	now := e.now().UTC()
	a, auctionOK := e.data.Auctions[auctionID]
	o, offerOK := e.data.Offers[offerID]
	p := e.data.Providers[o.ProviderID]
	if auctionOK && offerOK && p.Wallet == providerWallet && p.Wallet == a.Buyer {
		return AuctionBid{}, errors.New("provider self-dealing auction bid is prohibited")
	}
	if !auctionOK || a.Status != "open" || !a.ClosesAt.After(now) || !offerOK || o.Pricing != a.Mode || o.Resource != a.Resource || o.Currency != a.Currency || o.Status != "active" || !o.ExpiresAt.After(a.ClosesAt) || p.Wallet != providerWallet || p.Wallet == a.Buyer || p.Status != "verified" || p.Maintenance || (a.Region != "" && p.Region != a.Region) || units < o.MinUnits || units > o.MaxUnits || units > o.Capacity-o.ReservedUnits || unitPrice < 0 || unitPrice > o.UnitPrice || unitPrice > a.MaxUnitPrice || !validSource(source) {
		return AuctionBid{}, errors.New("eligible independent provider offer and bounded evidenced bid required")
	}
	if a.Mode == "reverse_auction" && units != a.Units {
		return AuctionBid{}, errors.New("reverse-auction bid must cover the full demand")
	}
	for _, existing := range e.data.AuctionBids {
		if existing.AuctionID == auctionID && existing.ProviderID == p.ID {
			return AuctionBid{}, errors.New("one immutable bid per provider and auction is allowed")
		}
	}
	b := AuctionBid{ID: e.next("auction-bid"), AuctionID: a.ID, ProviderID: p.ID, OfferID: o.ID, Status: "sealed", Units: units, UnitPrice: unitPrice, Source: source, CreatedAt: now}
	b.CommitmentDigest = Digest(map[string]any{"auctionId": b.AuctionID, "providerId": b.ProviderID, "offerId": b.OfferID, "units": b.Units, "unitPrice": b.UnitPrice, "source": b.Source})
	e.data.AuctionBids[b.ID] = b
	e.audit(providerWallet, "auction_bid_submit", b.ID, b.CommitmentDigest)
	return b, e.save()
}

// ClearAuction performs deterministic, pay-as-bid clearing after the deadline.
// Price is primary; provider quality score and stable provider ID break ties.
// A batch clears only when the complete requested quantity can be allocated.
func (e *Engine) ClearAuction(operator, auctionID string) (AuctionClearing, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	now := e.now().UTC()
	a, ok := e.data.Auctions[auctionID]
	if !ok || operator == "" || a.Status != "open" || now.Before(a.ClosesAt) {
		return AuctionClearing{}, errors.New("open elapsed auction and operator identity required")
	}
	bids := []AuctionBid{}
	for _, b := range e.data.AuctionBids {
		o := e.data.Offers[b.OfferID]
		p := e.data.Providers[b.ProviderID]
		if b.AuctionID == a.ID && b.Status == "sealed" && o.Status == "active" && o.ExpiresAt.After(now) && p.Status == "verified" && !p.Maintenance && o.Capacity-o.ReservedUnits >= b.Units {
			bids = append(bids, b)
		}
	}
	sort.Slice(bids, func(i, j int) bool {
		if bids[i].UnitPrice != bids[j].UnitPrice {
			return bids[i].UnitPrice < bids[j].UnitPrice
		}
		si := score(e.data.Providers[bids[i].ProviderID], e.data.Offers[bids[i].OfferID])
		sj := score(e.data.Providers[bids[j].ProviderID], e.data.Offers[bids[j].OfferID])
		if si != sj {
			return si > sj
		}
		return bids[i].ProviderID < bids[j].ProviderID
	})
	selected := []AuctionBid{}
	remaining := a.Units
	for _, b := range bids {
		if a.Mode == "reverse_auction" {
			selected = append(selected, b)
			remaining = 0
			break
		}
		allocated := b.Units
		if allocated > remaining {
			allocated = remaining
		}
		if allocated < e.data.Offers[b.OfferID].MinUnits {
			continue
		}
		b.AllocatedUnits = allocated
		selected = append(selected, b)
		remaining -= allocated
		if remaining == 0 {
			break
		}
	}
	if remaining > 0 {
		a.Status, a.ClearedAt = "failed_insufficient_bids", now
		for _, bid := range bids {
			bid.Status = "rejected_insufficient_fill"
			e.data.AuctionBids[bid.ID] = bid
		}
		e.data.Auctions[a.ID] = a
		e.audit(operator, "auction_clear", a.ID, a.Status)
		return AuctionClearing{Auction: a, Quotes: []Quote{}, Bids: bids}, e.save()
	}
	type clearingAmount struct {
		allocated    int64
		providerCost int64
		fee          int64
		gross        int64
	}
	amounts := make(map[string]clearingAmount, len(selected))
	for _, b := range selected {
		allocated := b.AllocatedUnits
		if a.Mode == "reverse_auction" {
			allocated = b.Units
		}
		providerCost, ok := checkedMulNonNegative(b.UnitPrice, allocated)
		if !ok {
			return AuctionClearing{}, errAmountOutOfRange
		}
		fee, ok := checkedProRataNonNegative(providerCost, a.ProtocolFeeBPS, 10_000)
		if !ok {
			return AuctionClearing{}, errAmountOutOfRange
		}
		gross, ok := checkedAddNonNegative(providerCost, fee)
		if !ok {
			return AuctionClearing{}, errAmountOutOfRange
		}
		amounts[b.ID] = clearingAmount{allocated: allocated, providerCost: providerCost, fee: fee, gross: gross}
	}

	quotes := make([]Quote, 0, len(selected))
	for _, bid := range bids {
		bid.Status = "rejected_price_or_capacity"
		e.data.AuctionBids[bid.ID] = bid
	}
	for _, b := range selected {
		o := e.data.Offers[b.OfferID]
		amount := amounts[b.ID]
		b.AllocatedUnits = amount.allocated
		q := Quote{ID: e.next("quote"), Buyer: a.Buyer, OfferID: o.ID, AuctionID: a.ID, AuctionBidID: b.ID, ProviderID: b.ProviderID, Resource: a.Resource, Unit: a.Unit, Currency: a.Currency, Status: "quote", Units: amount.allocated, UnitPrice: b.UnitPrice, ProviderCost: amount.providerCost, ProtocolFee: amount.fee, GrossCost: amount.gross, Source: b.Source, CreatedAt: now, ExpiresAt: now.Add(5 * time.Minute)}
		if q.ExpiresAt.After(o.ExpiresAt) {
			q.ExpiresAt = o.ExpiresAt
		}
		e.data.Quotes[q.ID] = q
		a.QuoteIDs = append(a.QuoteIDs, q.ID)
		b.Status = "cleared"
		e.data.AuctionBids[b.ID] = b
		quotes = append(quotes, q)
	}
	a.Status, a.ClearedAt = "cleared", now
	e.data.Auctions[a.ID] = a
	e.audit(operator, "auction_clear", a.ID, fmt.Sprintf("cleared_quotes=%d", len(quotes)))
	return AuctionClearing{Auction: a, Quotes: quotes, Bids: selected}, e.save()
}

func (e *Engine) AuctionSnapshot() ([]Auction, []AuctionBid) {
	e.mu.Lock()
	defer e.mu.Unlock()
	auctions := make([]Auction, 0, len(e.data.Auctions))
	for _, a := range e.data.Auctions {
		auctions = append(auctions, a)
	}
	bids := make([]AuctionBid, 0, len(e.data.AuctionBids))
	for _, b := range e.data.AuctionBids {
		bids = append(bids, b)
	}
	return auctions, bids
}

func (e *Engine) RequestErasure(actor, reason string, source Source) (ErasureRequest, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if actor == "" || strings.TrimSpace(reason) == "" || !validSource(source) {
		return ErasureRequest{}, errors.New("authenticated subject, reason and request source required")
	}
	for _, request := range e.data.ErasureRequests {
		if request.Subject == actor && request.Status == "requested" {
			return ErasureRequest{}, errors.New("an erasure request is already pending")
		}
	}
	now := e.now().UTC()
	r := ErasureRequest{ID: e.next("erasure"), Subject: actor, Status: "requested", Reason: reason, Source: source, RequestedAt: now}
	e.data.ErasureRequests[r.ID] = r
	e.audit(actor, "erasure_request", r.ID, "requested")
	return r, e.save()
}

// FulfillErasure pseudonymizes identity and removes provider profile content,
// but deliberately preserves economic, dispute, receipt and audit records.
// Live obligations fail closed and must be completed or exited first.
func (e *Engine) FulfillErasure(operator, requestID string) (ErasureRequest, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	r, ok := e.data.ErasureRequests[requestID]
	if !ok || r.Status != "requested" || operator == "" || operator == r.Subject {
		return ErasureRequest{}, errors.New("independent operator and pending erasure request required")
	}
	actor := r.Subject
	for _, p := range e.data.Providers {
		if p.Wallet == actor && p.Status == "verified" {
			return ErasureRequest{}, errors.New("verified provider must complete guarded exit before erasure")
		}
	}
	for _, o := range e.data.Orders {
		if o.Buyer == actor && o.Status != "asset_settlement_confirmed" && o.Status != "provider_failed" && o.Status != "refunded" {
			return ErasureRequest{}, errors.New("subject has non-terminal orders")
		}
	}
	for _, d := range e.data.Disputes {
		o := e.data.Orders[d.OrderID]
		p := e.data.Providers[o.ProviderID]
		if (o.Buyer == actor || p.Wallet == actor) && d.Status != "final" {
			return ErasureRequest{}, errors.New("subject has an unresolved dispute or appeal")
		}
	}
	for _, a := range e.data.Auctions {
		if a.Buyer == actor && a.Status == "open" {
			return ErasureRequest{}, errors.New("subject has an open procurement auction")
		}
	}
	pseudonym := "deleted:" + Digest(actor)[:24]
	for id, p := range e.data.Providers {
		if p.Wallet == actor {
			p.Wallet, p.Name, p.Hardware, p.Evidence = pseudonym, "Deleted provider", []string{}, []string{}
			p.Source.URI, p.Source.Coverage = "", "identity erased; economic record retained"
			e.data.Providers[id] = p
		}
	}
	for id, q := range e.data.Quotes {
		if q.Buyer == actor {
			q.Buyer = pseudonym
			e.data.Quotes[id] = q
		}
	}
	for id, o := range e.data.Orders {
		if o.Buyer == actor {
			o.Buyer = pseudonym
			e.data.Orders[id] = o
		}
	}
	for id, m := range e.data.Meters {
		if m.Buyer == actor {
			m.Buyer = pseudonym
			e.data.Meters[id] = m
		}
	}
	for id, a := range e.data.Auctions {
		if a.Buyer == actor {
			a.Buyer = pseudonym
			e.data.Auctions[id] = a
		}
	}
	for id, d := range e.data.Disputes {
		if d.OpenedBy == actor {
			d.OpenedBy = pseudonym
		}
		if d.AppealBy == actor {
			d.AppealBy = pseudonym
		}
		e.data.Disputes[id] = d
	}
	for i := range e.data.Audit {
		if e.data.Audit[i].Actor == actor {
			e.data.Audit[i].Actor = pseudonym
		}
	}
	now := e.now().UTC()
	r.Subject, r.Status, r.FulfilledAt, r.FulfilledBy = pseudonym, "fulfilled", now, operator
	e.data.ErasureRequests[r.ID] = r
	e.audit(operator, "erasure_fulfill", r.ID, "pseudonymized_records_retained")
	return r, e.save()
}

// ApplyRetention removes transient expired quotes after 30 days and rejected
// auction material after 90 days. Settlement, meter, receipt, dispute and audit
// records are never removed by this sweep.
func (e *Engine) ApplyRetention(operator string) (RetentionReport, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if operator == "" {
		return RetentionReport{}, errors.New("retention operator identity required")
	}
	now := e.now().UTC()
	report := RetentionReport{PolicyVersion: "resource-market-retention-v1", AppliedAt: now}
	for id, q := range e.data.Quotes {
		if q.Status == "quote" && q.ExpiresAt.Before(now.Add(-30*24*time.Hour)) {
			delete(e.data.Quotes, id)
			report.ExpiredQuotesDeleted++
		}
	}
	for id, bid := range e.data.AuctionBids {
		if strings.HasPrefix(bid.Status, "rejected_") && bid.CreatedAt.Before(now.Add(-90*24*time.Hour)) {
			delete(e.data.AuctionBids, id)
			report.RejectedBidsDeleted++
		}
	}
	for id, auction := range e.data.Auctions {
		if auction.Status == "failed_insufficient_bids" && auction.ClearedAt.Before(now.Add(-90*24*time.Hour)) {
			delete(e.data.Auctions, id)
			report.FailedAuctionsDeleted++
		}
	}
	e.audit(operator, "retention_apply", "market", fmt.Sprintf("quotes=%d auctions=%d bids=%d", report.ExpiredQuotesDeleted, report.FailedAuctionsDeleted, report.RejectedBidsDeleted))
	return report, e.save()
}

func (e *Engine) ErasureSnapshot() []ErasureRequest {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make([]ErasureRequest, 0, len(e.data.ErasureRequests))
	for _, request := range e.data.ErasureRequests {
		out = append(out, request)
	}
	return out
}

func (e *Engine) CreateQuote(buyer, offerID string, units, protocolFee int64) (Quote, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	o, ok := e.data.Offers[offerID]
	now := e.now().UTC()
	p := e.data.Providers[o.ProviderID]
	buyer = strings.TrimSpace(buyer)
	if buyer == "" || !ok || o.Status != "active" || !o.ExpiresAt.After(now) || units < o.MinUnits || units > o.MaxUnits || units > o.Capacity-o.ReservedUnits || protocolFee < 0 {
		return Quote{}, errors.New("active available offer and bounded units are required")
	}
	if buyer == p.Wallet {
		return Quote{}, errors.New("provider self-dealing quote is prohibited")
	}
	providerCost, amountOK := checkedMulNonNegative(o.UnitPrice, units)
	if !amountOK {
		return Quote{}, errAmountOutOfRange
	}
	grossCost, amountOK := checkedAddNonNegative(providerCost, protocolFee)
	if !amountOK {
		return Quote{}, errAmountOutOfRange
	}
	q := Quote{ID: e.next("quote"), Buyer: buyer, OfferID: o.ID, ProviderID: o.ProviderID, Resource: o.Resource, Unit: o.Unit, Currency: o.Currency, Status: "quote", Units: units, UnitPrice: o.UnitPrice, ProviderCost: providerCost, ProtocolFee: protocolFee, GrossCost: grossCost, Source: o.Source, CreatedAt: now, ExpiresAt: now.Add(5 * time.Minute)}
	if q.ExpiresAt.After(o.ExpiresAt) {
		q.ExpiresAt = o.ExpiresAt
	}
	e.data.Quotes[q.ID] = q
	e.audit(buyer, "quote_create", q.ID, "quote")
	return q, e.save()
}

func (e *Engine) AcceptIntent(buyer, quoteID, intentDigest string) (Order, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	q, ok := e.data.Quotes[quoteID]
	now := e.now().UTC()
	if !ok || q.Buyer != buyer || q.Status != "quote" || !q.ExpiresAt.After(now) || len(intentDigest) != 64 {
		return Order{}, errors.New("unexpired owner quote and SHA-256 intent digest are required")
	}
	o := Order{ID: e.next("order"), Buyer: buyer, ProviderID: q.ProviderID, QuoteID: q.ID, Resource: q.Resource, Unit: q.Unit, Status: "accepted", Units: q.Units, IntentDigest: intentDigest, MeterIDs: []string{}, AuditIDs: []string{}, CreatedAt: now, UpdatedAt: now}
	o.AuditIDs = append(o.AuditIDs, e.audit(buyer, "intent_accept", o.ID, "accepted"))
	e.data.Orders[o.ID] = o
	q.Status = "accepted"
	e.data.Quotes[q.ID] = q
	return o, e.save()
}

func (e *Engine) Reserve(providerWallet, orderID, evidence string) (Order, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	o, ok := e.data.Orders[orderID]
	p := e.data.Providers[o.ProviderID]
	q, quoteOK := e.data.Quotes[o.QuoteID]
	offer, offerOK := e.data.Offers[q.OfferID]
	if !ok || !quoteOK || !offerOK || p.Wallet != providerWallet || o.Status != "accepted" || q.Status != "accepted" || evidence == "" || q.ProviderID != o.ProviderID || offer.ProviderID != o.ProviderID || q.Resource != o.Resource || offer.Resource != o.Resource || q.Unit != o.Unit || offer.Unit != o.Unit || offer.Capacity-offer.ReservedUnits < o.Units {
		return Order{}, errors.New("provider-owned accepted order, evidence and available capacity required")
	}
	p.Reserved[o.Resource] += o.Units
	offer.ReservedUnits += o.Units
	o.ReservedUnits = o.Units
	o.ReservationEvidence = evidence
	o.Status = "capacity_reserved"
	o.UpdatedAt = e.now().UTC()
	o.AuditIDs = append(o.AuditIDs, e.audit(providerWallet, "capacity_reserve", o.ID, o.Status))
	e.data.Providers[p.ID] = p
	e.data.Offers[offer.ID] = offer
	e.data.Orders[o.ID] = o
	return o, e.save()
}

func (e *Engine) releaseReservationLocked(o *Order) error {
	if o.ReservedUnits <= 0 {
		return errors.New("active order reservation is missing")
	}
	q, quoteOK := e.data.Quotes[o.QuoteID]
	offer, offerOK := e.data.Offers[q.OfferID]
	p, providerOK := e.data.Providers[o.ProviderID]
	if !quoteOK || !offerOK || !providerOK || q.ProviderID != o.ProviderID || offer.ProviderID != o.ProviderID || q.Resource != o.Resource || offer.Resource != o.Resource || q.Unit != o.Unit || offer.Unit != o.Unit {
		return errors.New("reservation release lineage is incomplete or mismatched")
	}
	if offer.ReservedUnits < o.ReservedUnits || p.Reserved[o.Resource] < o.ReservedUnits {
		return errors.New("reservation release would underflow capacity ledger")
	}
	offer.ReservedUnits -= o.ReservedUnits
	p.Reserved[o.Resource] -= o.ReservedUnits
	o.ReservedUnits = 0
	e.data.Offers[offer.ID] = offer
	e.data.Providers[p.ID] = p
	return nil
}

func (e *Engine) StartService(providerWallet, orderID, evidence string) (Order, error) {
	return e.transitionProvider(providerWallet, orderID, "capacity_reserved", "service_started", evidence)
}
func (e *Engine) transitionProvider(actor, id, from, to, evidence string) (Order, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	o, ok := e.data.Orders[id]
	p := e.data.Providers[o.ProviderID]
	if !ok || p.Wallet != actor || o.Status != from || evidence == "" {
		return Order{}, errors.New("invalid provider order transition or missing evidence")
	}
	o.Status = to
	o.ServiceEvidence = evidence
	o.UpdatedAt = e.now().UTC()
	o.AuditIDs = append(o.AuditIDs, e.audit(actor, to, id, to))
	e.data.Orders[id] = o
	return o, e.save()
}

func (e *Engine) RecordUsage(providerWallet, orderID string, start, end time.Time, quantity int64, integrity string, source Source) (Meter, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	o, ok := e.data.Orders[orderID]
	p := e.data.Providers[o.ProviderID]
	q := e.data.Quotes[o.QuoteID]
	parts := strings.SplitN(integrity, ":", 3)
	if !ok || p.Wallet != providerWallet || len(parts) != 3 || parts[0] != "ed25519" || !validSource(source) {
		return Meter{}, errors.New("active service, bounded usage interval, Ed25519 evidence and source required")
	}
	priorQuantity, priorFee, err := e.validateMeterWindowLocked(o, start, end, quantity)
	if err != nil {
		return Meter{}, err
	}
	worker, keyOK := e.data.WorkerKeys[parts[1]]
	publicKey, keyErr := base64.RawURLEncoding.DecodeString(worker.PublicKey)
	signature, sigErr := base64.RawURLEncoding.DecodeString(parts[2])
	payload, payloadErr := MeterPayloadJSON(o, q, start, end, quantity, source)
	if !keyOK || worker.ProviderID != p.ID || worker.Status != "active" || worker.ExpiresAt.Before(end.UTC()) || start.UTC().Before(worker.CreatedAt) || keyErr != nil || sigErr != nil || payloadErr != nil || !ed25519.Verify(ed25519.PublicKey(publicKey), payload, signature) {
		return Meter{}, errors.New("worker meter signature is invalid, expired, revoked or bound to another provider/payload")
	}
	cost, amountOK := checkedMulNonNegative(quantity, q.UnitPrice)
	if !amountOK {
		return Meter{}, errAmountOutOfRange
	}
	fee := int64(0)
	if o.Units > 0 {
		cumulativeQuantity, ok := checkedAddNonNegative(priorQuantity, quantity)
		if !ok {
			return Meter{}, errAmountOutOfRange
		}
		cumulativeFee, ok := checkedProRataNonNegative(q.ProtocolFee, cumulativeQuantity, o.Units)
		if !ok {
			return Meter{}, errAmountOutOfRange
		}
		if cumulativeFee < priorFee {
			return Meter{}, errors.New("meter fee lineage is invalid")
		}
		fee = cumulativeFee - priorFee
	}
	grossCost, amountOK := checkedAddNonNegative(cost, fee)
	if !amountOK {
		return Meter{}, errAmountOutOfRange
	}
	m := Meter{ID: e.next("meter"), OrderID: o.ID, Buyer: o.Buyer, ProviderID: o.ProviderID, Resource: o.Resource, Unit: o.Unit, IntegrityEvidence: "verified Ed25519 worker signature", Status: "metered_usage", Start: start.UTC(), End: end.UTC(), Quantity: quantity, Rate: q.UnitPrice, GrossCost: grossCost, ProviderNet: cost, ProtocolFee: fee, Source: source, WorkerKeyID: worker.ID, Signature: parts[2]}
	e.data.Meters[m.ID] = m
	o.MeterIDs = append(o.MeterIDs, m.ID)
	o.Status = "metered_usage"
	o.UpdatedAt = e.now().UTC()
	o.AuditIDs = append(o.AuditIDs, e.audit(providerWallet, "meter_usage", m.ID, "metered_usage"))
	e.data.Orders[o.ID] = o
	return m, e.save()
}

func (e *Engine) CompleteService(providerWallet, orderID, evidence string) (Order, error) {
	return e.transitionProvider(providerWallet, orderID, "metered_usage", "service_completed", evidence)
}
func (e *Engine) MarkSettlementPending(actor, orderID string) (Order, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	o, ok := e.data.Orders[orderID]
	if !ok || actor != o.Buyer || o.Status != "service_completed" {
		return Order{}, errors.New("buyer-owned completed service required")
	}
	o.Status = "settlement_pending"
	o.UpdatedAt = e.now().UTC()
	o.AuditIDs = append(o.AuditIDs, e.audit(actor, "settlement_pending", o.ID, o.Status))
	e.data.Orders[o.ID] = o
	return o, e.save()
}

func (e *Engine) ConfirmSettlement(authority, orderID string, r Receipt) (Receipt, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	o, ok := e.data.Orders[orderID]
	authority = strings.TrimSpace(authority)
	r.TransactionHash = strings.ToLower(strings.TrimSpace(r.TransactionHash))
	r.Evidence = strings.TrimSpace(r.Evidence)
	r.Asset = strings.TrimSpace(r.Asset)
	if !ok || authority == "" || o.Status != "settlement_pending" || r.TransactionHash == "" || r.Evidence == "" || r.Asset == "" || !validSource(r.Source) {
		return Receipt{}, errors.New("authoritative settlement evidence and pending order required")
	}
	for _, existing := range e.data.Receipts {
		if strings.EqualFold(strings.TrimSpace(existing.TransactionHash), r.TransactionHash) {
			return Receipt{}, errors.New("settlement transaction hash was already consumed by another receipt")
		}
	}
	var gross, net, fee int64
	for _, id := range o.MeterIDs {
		m, meterOK := e.data.Meters[id]
		if !meterOK || m.OrderID != o.ID {
			return Receipt{}, errors.New("meter lineage is incomplete or mismatched")
		}
		var amountOK bool
		gross, amountOK = checkedAddNonNegative(gross, m.GrossCost)
		if !amountOK {
			return Receipt{}, errAmountOutOfRange
		}
		net, amountOK = checkedAddNonNegative(net, m.ProviderNet)
		if !amountOK {
			return Receipt{}, errAmountOutOfRange
		}
		fee, amountOK = checkedAddNonNegative(fee, m.ProtocolFee)
		if !amountOK {
			return Receipt{}, errAmountOutOfRange
		}
	}
	if r.GrossCost != gross || r.ProviderNet != net || r.ProtocolFee != fee || r.Refund < 0 || r.Refund > gross {
		return Receipt{}, errors.New("receipt amounts do not reconcile to signed metering")
	}
	if err := e.releaseReservationLocked(&o); err != nil {
		return Receipt{}, err
	}
	r.ID = e.next("receipt")
	r.OrderID = o.ID
	r.Status = "asset_settlement_confirmed"
	r.ConfirmedAt = e.now().UTC()
	e.data.Receipts[r.ID] = r
	o.Status = r.Status
	o.UpdatedAt = r.ConfirmedAt
	o.AuditIDs = append(o.AuditIDs, e.audit(authority, "settlement_confirm", r.ID, r.Status))
	e.data.Orders[o.ID] = o
	p := e.data.Providers[o.ProviderID]
	p.CompletionRate = (p.CompletionRate*float64(p.FailureCount) + 1) / float64(p.FailureCount+1)
	e.data.Providers[p.ID] = p
	return r, e.save()
}

// ReportFailure releases reserved capacity and records an honest service
// failure. It never fabricates a refund or asset movement; those require a
// separately evidenced dispute decision and settlement receipt.
func (e *Engine) ReportFailure(providerWallet, orderID, evidence string) (Order, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	o, ok := e.data.Orders[orderID]
	p := e.data.Providers[o.ProviderID]
	if !ok || p.Wallet != providerWallet || evidence == "" || (o.Status != "capacity_reserved" && o.Status != "service_started" && o.Status != "metered_usage") {
		return Order{}, errors.New("provider-owned active order and failure evidence required")
	}
	if err := e.releaseReservationLocked(&o); err != nil {
		return Order{}, err
	}
	p = e.data.Providers[o.ProviderID]
	p.FailureCount++
	o.Status = "provider_failed"
	o.ServiceEvidence = evidence
	o.UpdatedAt = e.now().UTC()
	o.AuditIDs = append(o.AuditIDs, e.audit(providerWallet, "provider_failure", o.ID, o.Status))
	e.data.Providers[p.ID], e.data.Orders[o.ID] = p, o
	return o, e.save()
}

// RetryFailure creates at most one fresh accepted order bound to the same quote
// and buyer. The failed order's status and evidence remain unchanged; explicit
// bidirectional lineage makes the retry durable and prevents retry chains.
func (e *Engine) RetryFailure(buyer, failedOrderID string) (Order, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	buyer = strings.TrimSpace(buyer)
	failed, ok := e.data.Orders[failedOrderID]
	if !ok || buyer == "" || failed.Buyer != buyer || failed.Status != "provider_failed" {
		return Order{}, errors.New("buyer-owned failed order required")
	}
	if failed.RetryOfOrderID != "" || failed.RetryOrderID != "" {
		return Order{}, errors.New("failure retry already consumed or retry chain prohibited")
	}
	quote, quoteOK := e.data.Quotes[failed.QuoteID]
	if !quoteOK || quote.Buyer != failed.Buyer || quote.ProviderID != failed.ProviderID || quote.Resource != failed.Resource || quote.Unit != failed.Unit || quote.Units != failed.Units {
		return Order{}, errors.New("failed order retry lineage is incomplete or mismatched")
	}
	now := e.now().UTC()
	retry := Order{ID: e.next("order"), Buyer: buyer, ProviderID: failed.ProviderID, QuoteID: failed.QuoteID, Resource: failed.Resource, Unit: failed.Unit, Status: "accepted", Units: failed.Units, IntentDigest: failed.IntentDigest, RetryOfOrderID: failed.ID, MeterIDs: []string{}, AuditIDs: []string{}, CreatedAt: now, UpdatedAt: now}
	retry.AuditIDs = append(retry.AuditIDs, e.audit(buyer, "failure_retry", retry.ID, "accepted"))
	failed.RetryOrderID = retry.ID
	failed.AuditIDs = append(failed.AuditIDs, e.audit(buyer, "failure_retry_claimed", failed.ID, retry.ID))
	e.data.Orders[failed.ID] = failed
	e.data.Orders[retry.ID] = retry
	return retry, e.save()
}

func (e *Engine) OpenDispute(actor, orderID, reason, evidence string) (Dispute, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	o, ok := e.data.Orders[orderID]
	p := e.data.Providers[o.ProviderID]
	if !ok || (actor != o.Buyer && actor != p.Wallet) || reason == "" || evidence == "" || o.Status != "provider_failed" {
		return Dispute{}, errors.New("order party, failed order, reason and evidence required")
	}
	for _, d := range e.data.Disputes {
		if d.OrderID == orderID && (d.Status == "open" || d.Status == "decided_pending_appeal" || d.Status == "appealed") {
			return Dispute{}, errors.New("active dispute already exists")
		}
	}
	now := e.now().UTC()
	d := Dispute{ID: e.next("dispute"), OrderID: orderID, OpenedBy: actor, Reason: reason, Evidence: evidence, Status: "open", NoticeAt: now, UpdatedAt: now}
	e.data.Disputes[d.ID] = d
	e.audit(actor, "dispute_open", d.ID, "notice_issued")
	return d, e.save()
}

func (e *Engine) DecideDispute(reviewer, disputeID, decision, evidence string, penalty, refund int64) (Dispute, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	d, ok := e.data.Disputes[disputeID]
	o := e.data.Orders[d.OrderID]
	p := e.data.Providers[o.ProviderID]
	if !ok || reviewer == "" || reviewer == o.Buyer || reviewer == p.Wallet || d.Status != "open" || evidence == "" {
		return Dispute{}, errors.New("independent reviewer, open dispute and decision evidence required")
	}
	if decision != "upheld" && decision != "rejected" {
		return Dispute{}, errors.New("decision must be upheld or rejected")
	}
	if penalty < 0 || refund < 0 || penalty > p.BondAvailable {
		return Dispute{}, errors.New("penalty/refund must be non-negative and penalty capped by available bond")
	}
	var metered int64
	for _, id := range o.MeterIDs {
		meter, meterOK := e.data.Meters[id]
		if !meterOK || meter.OrderID != o.ID {
			return Dispute{}, errors.New("meter lineage is incomplete or mismatched")
		}
		var amountOK bool
		metered, amountOK = checkedAddNonNegative(metered, meter.GrossCost)
		if !amountOK {
			return Dispute{}, errAmountOutOfRange
		}
	}
	if refund > metered {
		return Dispute{}, errors.New("refund exceeds evidenced metered gross cost")
	}
	if decision == "rejected" && (penalty != 0 || refund != 0) {
		return Dispute{}, errors.New("rejected dispute cannot impose penalty or refund")
	}
	now := e.now().UTC()
	d.Status = "decided_pending_appeal"
	d.Decision = decision
	d.Reviewer = reviewer
	d.Evidence = evidence
	d.Penalty = penalty
	d.Refund = refund
	d.AppealUntil = now.Add(7 * 24 * time.Hour)
	d.UpdatedAt = now
	e.data.Disputes[d.ID] = d
	e.audit(reviewer, "dispute_decide", d.ID, d.Status)
	return d, e.save()
}

func (e *Engine) AppealDispute(actor, disputeID, reason, evidence string) (Dispute, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	d, ok := e.data.Disputes[disputeID]
	o := e.data.Orders[d.OrderID]
	p := e.data.Providers[o.ProviderID]
	now := e.now().UTC()
	if !ok || (actor != o.Buyer && actor != p.Wallet) || d.Status != "decided_pending_appeal" || !d.AppealUntil.After(now) || reason == "" || evidence == "" {
		return Dispute{}, errors.New("eligible party, open appeal window, reason and evidence required")
	}
	d.Status = "appealed"
	d.AppealBy = actor
	d.AppealReason = reason
	d.AppealEvidence = evidence
	d.UpdatedAt = now
	e.data.Disputes[d.ID] = d
	e.audit(actor, "dispute_appeal", d.ID, "appealed")
	return d, e.save()
}

func (e *Engine) ResolveAppeal(reviewer, disputeID, decision, evidence string) (Dispute, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	d, ok := e.data.Disputes[disputeID]
	o := e.data.Orders[d.OrderID]
	p := e.data.Providers[o.ProviderID]
	if !ok || d.Status != "appealed" || reviewer == "" || reviewer == d.Reviewer || reviewer == o.Buyer || reviewer == p.Wallet || evidence == "" || (decision != "affirmed" && decision != "overturned") {
		return Dispute{}, errors.New("independent appeal reviewer and affirmed/overturned evidence required")
	}
	d.AppealDecision = decision
	d.UpdatedAt = e.now().UTC()
	if decision == "overturned" {
		d.Penalty = 0
		d.Refund = 0
		d.Decision = "rejected"
	}
	d.Status = "final"
	if d.Decision == "upheld" {
		p.BondAvailable -= d.Penalty
		p.DisputeCount++
		e.data.Providers[p.ID] = p
	}
	e.data.Disputes[d.ID] = d
	e.audit(reviewer, "appeal_resolve", d.ID, decision)
	return d, e.save()
}

func (e *Engine) Snapshot() ([]Provider, []Offer, []Quote, []Order, []Meter, []Receipt, []Dispute) {
	e.mu.Lock()
	defer e.mu.Unlock()
	ps := make([]Provider, 0, len(e.data.Providers))
	for _, v := range e.data.Providers {
		ps = append(ps, v)
	}
	os := make([]Offer, 0, len(e.data.Offers))
	for _, v := range e.data.Offers {
		os = append(os, v)
	}
	qs := make([]Quote, 0, len(e.data.Quotes))
	for _, v := range e.data.Quotes {
		qs = append(qs, v)
	}
	ords := make([]Order, 0, len(e.data.Orders))
	for _, v := range e.data.Orders {
		ords = append(ords, v)
	}
	ms := make([]Meter, 0, len(e.data.Meters))
	for _, v := range e.data.Meters {
		ms = append(ms, v)
	}
	rs := make([]Receipt, 0, len(e.data.Receipts))
	for _, v := range e.data.Receipts {
		rs = append(rs, v)
	}
	ds := make([]Dispute, 0, len(e.data.Disputes))
	for _, v := range e.data.Disputes {
		ds = append(ds, v)
	}
	return ps, os, qs, ords, ms, rs, ds
}

func Digest(v any) string {
	b, _ := json.Marshal(v)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
