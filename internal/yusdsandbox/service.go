package yusdsandbox

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

var evidencePattern = regexp.MustCompile(`^(sha256:)?[0-9a-fA-F]{64}$`)
var idempotencyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$`)
var redemptionIDPattern = regexp.MustCompile(`^yred_[0-9a-f]{24}$`)
var ErrInvalid = errors.New("invalid YUSD sandbox request")
var ErrConflict = errors.New("YUSD sandbox request conflicts with state")
var ErrUnavailable = errors.New("YUSD sandbox operation unavailable")
var ErrNotFound = errors.New("YUSD sandbox record not found")

type Service struct {
	mu    sync.Mutex
	cfg   Config
	state state
}

func New(cfg Config) (*Service, error) {
	cfg.StatePath = strings.TrimSpace(cfg.StatePath)
	cfg.APIKey = strings.TrimSpace(cfg.APIKey)
	if cfg.StatePath == "" || len(cfg.APIKey) < 16 {
		return nil, errors.New("YUSD sandbox state path and API key are required")
	}
	if cfg.Now == nil {
		cfg.Now = func() time.Time { return time.Now().UTC() }
	}
	value, err := loadState(cfg.StatePath)
	if err != nil {
		return nil, err
	}
	s := &Service{cfg: cfg, state: value}
	if err := s.validateLocked(); err != nil {
		return nil, err
	}
	if value.Integrity == "" {
		if err := saveState(cfg.StatePath, &s.state); err != nil {
			return nil, err
		}
	}
	return s, nil
}
func (s *Service) Authorized(value string) bool {
	value = strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
	return len(value) == len(s.cfg.APIKey) && subtle.ConstantTimeCompare([]byte(value), []byte(s.cfg.APIKey)) == 1
}
func (s *Service) DepositReserve(req MutationRequest) (MutationResult[Snapshot], error) {
	normalized, digestValue, err := normalizeMutation(req, false)
	if err != nil {
		return MutationResult[Snapshot]{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if replay, ok, replayErr := s.replaySnapshot(normalized.IdempotencyKey, "reserve_deposit", digestValue); ok {
		return replay, replayErr
	}
	if s.state.Paused {
		return MutationResult[Snapshot]{}, ErrUnavailable
	}
	if s.state.Reserve > math.MaxUint64-normalized.Amount {
		return MutationResult[Snapshot]{}, ErrInvalid
	}
	before := cloneState(s.state)
	s.state.Reserve += normalized.Amount
	now := s.now()
	s.state.Idempotency[normalized.IdempotencyKey] = idempotencyRecord{Action: "reserve_deposit", Digest: digestValue, ObjectID: "sandbox-reserve"}
	appendAudit(&s.state, now, "test_reserve_deposited", "sandbox-reserve", normalized.EvidenceHash)
	if err := s.save(before); err != nil {
		return MutationResult[Snapshot]{}, err
	}
	return MutationResult[Snapshot]{Record: s.snapshotLocked(now)}, nil
}
func (s *Service) Mint(req MutationRequest) (MutationResult[Snapshot], error) {
	normalized, digestValue, err := normalizeMutation(req, true)
	if err != nil {
		return MutationResult[Snapshot]{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if replay, ok, replayErr := s.replaySnapshot(normalized.IdempotencyKey, "mint", digestValue); ok {
		return replay, replayErr
	}
	if s.state.Paused || s.state.ProviderStatus != "available" {
		return MutationResult[Snapshot]{}, ErrUnavailable
	}
	pending, _ := pendingRedemptions(s.state)
	if s.state.Reserve < s.state.Supply || s.state.Reserve-s.state.Supply < pending || s.state.Reserve-s.state.Supply-pending < normalized.Amount {
		return MutationResult[Snapshot]{}, fmt.Errorf("%w: insufficient unencumbered test reserve", ErrConflict)
	}
	if err := s.checkDaily(normalized.Account, normalized.Amount); err != nil {
		return MutationResult[Snapshot]{}, err
	}
	if s.state.Supply > math.MaxUint64-normalized.Amount || s.state.Accounts[normalized.Account] > math.MaxUint64-normalized.Amount {
		return MutationResult[Snapshot]{}, ErrInvalid
	}
	before := cloneState(s.state)
	s.state.Supply += normalized.Amount
	s.state.Accounts[normalized.Account] += normalized.Amount
	s.addDaily(normalized.Account, normalized.Amount)
	now := s.now()
	s.state.Idempotency[normalized.IdempotencyKey] = idempotencyRecord{Action: "mint", Digest: digestValue, ObjectID: normalized.Account}
	appendAudit(&s.state, now, "sandbox_yusd_minted", normalized.Account, normalized.EvidenceHash)
	if err := s.save(before); err != nil {
		return MutationResult[Snapshot]{}, err
	}
	return MutationResult[Snapshot]{Record: s.snapshotLocked(now)}, nil
}
func (s *Service) Redeem(req MutationRequest) (MutationResult[Redemption], error) {
	normalized, digestValue, err := normalizeMutation(req, true)
	if err != nil {
		return MutationResult[Redemption]{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if record, ok := s.state.Idempotency[normalized.IdempotencyKey]; ok {
		if record.Action != "redeem" || record.Digest != digestValue {
			return MutationResult[Redemption]{}, ErrConflict
		}
		return MutationResult[Redemption]{Record: s.state.Redemptions[record.ObjectID], Replayed: true}, nil
	}
	if s.state.Accounts[normalized.Account] < normalized.Amount || s.state.Supply < normalized.Amount {
		return MutationResult[Redemption]{}, fmt.Errorf("%w: insufficient YUSD sandbox balance", ErrConflict)
	}
	if err := s.checkDaily(normalized.Account, normalized.Amount); err != nil {
		return MutationResult[Redemption]{}, err
	}
	before := cloneState(s.state)
	s.state.Accounts[normalized.Account] -= normalized.Amount
	s.state.Supply -= normalized.Amount
	s.addDaily(normalized.Account, normalized.Amount)
	now := s.now()
	id := "yred_" + strings.TrimPrefix(digestValue, "sha256:")[:24]
	record := Redemption{ID: id, Account: normalized.Account, Amount: normalized.Amount, Status: "queued", RequestedAt: now, EvidenceHash: normalized.EvidenceHash}
	s.state.Redemptions[id] = record
	s.state.Idempotency[normalized.IdempotencyKey] = idempotencyRecord{Action: "redeem", Digest: digestValue, ObjectID: id}
	appendAudit(&s.state, now, "sandbox_redemption_queued", id, normalized.EvidenceHash)
	if err := s.save(before); err != nil {
		return MutationResult[Redemption]{}, err
	}
	return MutationResult[Redemption]{Record: record}, nil
}
func (s *Service) Fulfill(id string, req MutationRequest) (MutationResult[Redemption], error) {
	id = strings.TrimSpace(id)
	normalized, digestValue, err := normalizeMutation(req, false)
	if err != nil || !redemptionIDPattern.MatchString(id) {
		return MutationResult[Redemption]{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if replay, ok := s.state.Idempotency[normalized.IdempotencyKey]; ok {
		if replay.Action != "fulfill" || replay.Digest != digestValue || replay.ObjectID != id {
			return MutationResult[Redemption]{}, ErrConflict
		}
		return MutationResult[Redemption]{Record: s.state.Redemptions[id], Replayed: true}, nil
	}
	record, ok := s.state.Redemptions[id]
	if !ok {
		return MutationResult[Redemption]{}, ErrNotFound
	}
	if record.Status != "queued" || normalized.Amount != record.Amount {
		return MutationResult[Redemption]{}, ErrConflict
	}
	if s.state.Paused || s.state.ProviderStatus != "available" {
		return MutationResult[Redemption]{}, ErrUnavailable
	}
	if s.state.Reserve < record.Amount {
		return MutationResult[Redemption]{}, ErrConflict
	}
	before := cloneState(s.state)
	s.state.Reserve -= record.Amount
	now := s.now()
	record.Status = "completed"
	record.CompletedAt = &now
	s.state.Redemptions[id] = record
	s.state.Idempotency[normalized.IdempotencyKey] = idempotencyRecord{Action: "fulfill", Digest: digestValue, ObjectID: id}
	appendAudit(&s.state, now, "sandbox_redemption_completed", id, normalized.EvidenceHash)
	if err := s.save(before); err != nil {
		return MutationResult[Redemption]{}, err
	}
	return MutationResult[Redemption]{Record: record}, nil
}
func (s *Service) SetProvider(req ProviderRequest) (MutationResult[Snapshot], error) {
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	req.Status = strings.ToLower(strings.TrimSpace(req.Status))
	e, err := normalizeEvidence(req.EvidenceHash)
	if err != nil || !idempotencyPattern.MatchString(req.IdempotencyKey) || (req.Status != "available" && req.Status != "outage") {
		return MutationResult[Snapshot]{}, ErrInvalid
	}
	req.EvidenceHash = e
	digestValue, _ := digest(req)
	s.mu.Lock()
	defer s.mu.Unlock()
	if replay, ok, replayErr := s.replaySnapshot(req.IdempotencyKey, "provider_status", digestValue); ok {
		return replay, replayErr
	}
	before := cloneState(s.state)
	s.state.ProviderStatus = req.Status
	now := s.now()
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "provider_status", Digest: digestValue, ObjectID: req.Status}
	appendAudit(&s.state, now, "sandbox_provider_"+req.Status, req.Status, req.EvidenceHash)
	if err := s.save(before); err != nil {
		return MutationResult[Snapshot]{}, err
	}
	return MutationResult[Snapshot]{Record: s.snapshotLocked(now)}, nil
}
func (s *Service) SetPaused(req PauseRequest) (MutationResult[Snapshot], error) {
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	e, err := normalizeEvidence(req.EvidenceHash)
	if err != nil || !idempotencyPattern.MatchString(req.IdempotencyKey) {
		return MutationResult[Snapshot]{}, ErrInvalid
	}
	req.EvidenceHash = e
	digestValue, _ := digest(req)
	s.mu.Lock()
	defer s.mu.Unlock()
	if replay, ok, replayErr := s.replaySnapshot(req.IdempotencyKey, "pause", digestValue); ok {
		return replay, replayErr
	}
	before := cloneState(s.state)
	s.state.Paused = req.Paused
	now := s.now()
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "pause", Digest: digestValue, ObjectID: fmt.Sprint(req.Paused)}
	appendAudit(&s.state, now, fmt.Sprintf("sandbox_pause_%t", req.Paused), "sandbox-control", req.EvidenceHash)
	if err := s.save(before); err != nil {
		return MutationResult[Snapshot]{}, err
	}
	return MutationResult[Snapshot]{Record: s.snapshotLocked(now)}, nil
}
func (s *Service) Snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshotLocked(s.now())
}
func (s *Service) Balance(account string) (uint64, error) {
	canonical, err := accountaddress.Normalize(account)
	if err != nil {
		return 0, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state.Accounts[canonical], nil
}
func (s *Service) Redemptions() []Redemption {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Redemption, 0, len(s.state.Redemptions))
	for _, v := range s.state.Redemptions {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}
func (s *Service) Audit() []AuditEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]AuditEvent(nil), s.state.Audit...)
}
func (s *Service) now() time.Time { return s.cfg.Now().UTC() }
func (s *Service) snapshotLocked(now time.Time) Snapshot {
	pending, pendingErr := pendingRedemptions(s.state)
	required := uint64(0)
	accountingValid := pendingErr == nil && s.state.Supply <= math.MaxUint64-pending
	if accountingValid {
		required = s.state.Supply + pending
	}
	excess := uint64(0)
	if s.state.Reserve >= required {
		excess = s.state.Reserve - required
	}
	sum := uint64(0)
	reconciled := true
	for _, v := range s.state.Accounts {
		if sum > math.MaxUint64-v {
			reconciled = false
		} else {
			sum += v
		}
	}
	return Snapshot{SchemaVersion: 1, Product: "YUSD Sandbox", Network: "YNX Testnet", Symbol: "YUSD", Decimals: Decimals, Source: "ynx-yusd-sandbox-persistent-ledger", AsOf: now, Version: 1, ReserveUnits: s.state.Reserve, SupplyUnits: s.state.Supply, PendingRedemptionUnits: pending, RequiredBackingUnits: required, ExcessReserveUnits: excess, Solvent: accountingValid && s.state.Reserve >= required, Reconciled: accountingValid && reconciled && sum == s.state.Supply, Paused: s.state.Paused, ProviderStatus: s.state.ProviderStatus, ProviderOutage: s.state.ProviderStatus == "outage", RealityValue: false, ExternalReserveAttested: false, GuaranteedPeg: false, AccountDailyLimit: AccountDailyLimit, GlobalDailyLimit: GlobalDailyLimit, Failure: false}
}
func (s *Service) validateLocked() error {
	snapshot := s.snapshotLocked(s.now())
	if !snapshot.Solvent || !snapshot.Reconciled || (s.state.ProviderStatus != "available" && s.state.ProviderStatus != "outage") {
		return errors.New("YUSD sandbox state violates reserve or supply reconciliation")
	}
	for account := range s.state.Accounts {
		canonical, err := accountaddress.Normalize(account)
		if err != nil || canonical != account {
			return errors.New("YUSD sandbox state contains a non-canonical account")
		}
	}
	for id, redemption := range s.state.Redemptions {
		canonical, err := accountaddress.Normalize(redemption.Account)
		validStatus := redemption.Status == "queued" || redemption.Status == "completed"
		validCompletion := (redemption.Status == "queued" && redemption.CompletedAt == nil) || (redemption.Status == "completed" && redemption.CompletedAt != nil && !redemption.CompletedAt.Before(redemption.RequestedAt))
		if id != redemption.ID || !redemptionIDPattern.MatchString(id) || err != nil || canonical != redemption.Account || redemption.Amount == 0 || redemption.RequestedAt.IsZero() || !validStatus || !validCompletion || !evidencePattern.MatchString(redemption.EvidenceHash) {
			return errors.New("YUSD sandbox state contains an invalid redemption")
		}
	}
	for key, amount := range s.state.DailyGlobal {
		if _, err := time.Parse("2006-01-02", key); err != nil || amount > GlobalDailyLimit {
			return errors.New("YUSD sandbox state contains an invalid global daily limit record")
		}
	}
	for key, amount := range s.state.DailyAccount {
		parts := strings.Split(key, "|")
		if len(parts) != 2 || amount > AccountDailyLimit {
			return errors.New("YUSD sandbox state contains an invalid account daily limit record")
		}
		canonical, err := accountaddress.Normalize(parts[1])
		if _, dateErr := time.Parse("2006-01-02", parts[0]); dateErr != nil || err != nil || canonical != parts[1] || s.state.DailyGlobal[parts[0]] < amount {
			return errors.New("YUSD sandbox state contains an invalid account daily limit record")
		}
	}
	for key, record := range s.state.Idempotency {
		if !idempotencyPattern.MatchString(key) || !evidencePattern.MatchString(record.Digest) || strings.TrimSpace(record.Action) == "" || strings.TrimSpace(record.ObjectID) == "" {
			return errors.New("YUSD sandbox state contains an invalid idempotency record")
		}
	}
	return validateAudit(s.state.Audit)
}
func (s *Service) save(before state) error {
	if err := s.validateLocked(); err != nil {
		s.state = before
		return err
	}
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		s.state = before
		return err
	}
	return nil
}
func (s *Service) replaySnapshot(key, action, digestValue string) (MutationResult[Snapshot], bool, error) {
	record, ok := s.state.Idempotency[key]
	if !ok {
		return MutationResult[Snapshot]{}, false, nil
	}
	if record.Action != action || record.Digest != digestValue {
		return MutationResult[Snapshot]{}, true, ErrConflict
	}
	return MutationResult[Snapshot]{Record: s.snapshotLocked(s.now()), Replayed: true}, true, nil
}
func normalizeMutation(req MutationRequest, accountRequired bool) (MutationRequest, string, error) {
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	if !idempotencyPattern.MatchString(req.IdempotencyKey) || req.Amount == 0 {
		return MutationRequest{}, "", ErrInvalid
	}
	if accountRequired {
		canonical, err := accountaddress.Normalize(req.Account)
		if err != nil {
			return MutationRequest{}, "", ErrInvalid
		}
		req.Account = canonical
	} else if strings.TrimSpace(req.Account) != "" {
		return MutationRequest{}, "", ErrInvalid
	}
	e, err := normalizeEvidence(req.EvidenceHash)
	if err != nil {
		return MutationRequest{}, "", err
	}
	req.EvidenceHash = e
	d, _ := digest(req)
	return req, d, nil
}
func normalizeEvidence(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if !evidencePattern.MatchString(value) {
		return "", ErrInvalid
	}
	if !strings.HasPrefix(value, "sha256:") {
		value = "sha256:" + value
	}
	return value, nil
}
func cloneState(value state) state {
	raw, _ := json.Marshal(value)
	var out state
	_ = json.Unmarshal(raw, &out)
	return out
}
func pendingRedemptions(value state) (uint64, error) {
	var total uint64
	for _, v := range value.Redemptions {
		if v.Status == "queued" {
			if total > math.MaxUint64-v.Amount {
				return 0, ErrInvalid
			}
			total += v.Amount
		}
	}
	return total, nil
}
func (s *Service) checkDaily(account string, amount uint64) error {
	date := s.now().Format("2006-01-02")
	if amount > AccountDailyLimit || amount > GlobalDailyLimit || s.state.DailyAccount[date+"|"+account] > AccountDailyLimit-amount || s.state.DailyGlobal[date] > GlobalDailyLimit-amount {
		return fmt.Errorf("%w: daily limit exceeded", ErrConflict)
	}
	return nil
}
func (s *Service) addDaily(account string, amount uint64) {
	date := s.now().Format("2006-01-02")
	s.state.DailyAccount[date+"|"+account] += amount
	s.state.DailyGlobal[date] += amount
}
