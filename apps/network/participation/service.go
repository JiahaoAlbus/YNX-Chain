package participation

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/internal/localstore"
	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productstore"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

type journal struct {
	Version    int               `json:"version"`
	Generation uint64            `json:"generation"`
	Stopped    bool              `json:"stopped"`
	Entries    map[string]Entry  `json:"entries"`
	Slots      map[string]string `json:"slots"`
	Requests   map[string]string `json:"requests"`
}
type Service struct {
	mu         sync.Mutex
	path       string
	lock       *localstore.Lock
	reader     Reader
	wallet     Wallet
	data       journal
	active     map[string]context.CancelFunc
	wg         sync.WaitGroup
	closed     bool
	persistErr error
}

// New owns a private local journal. Wallet=nil is the normal production state
// until its original publisher owner supplies a real adapter. No HTTP endpoint
// or local helper ticket is promoted into Wallet signing authority.
func New(path string, reader Reader, wallet Wallet) (*Service, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || reader == nil {
		return nil, ErrInvalid
	}
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return nil, e
	}
	// Legacy owners are never deleted or silently adopted. New journals use the
	// parent's Unix kernel lock, whose persistent known marker survives a crash
	// while the kernel releases the dead writer's ownership automatically.
	if _, e := os.Lstat(path + ".owner"); e == nil {
		return nil, ErrConflict
	} else if !errors.Is(e, os.ErrNotExist) {
		return nil, e
	}
	lock, e := localstore.Acquire(path + ".owner.lock")
	if e != nil {
		return nil, fmt.Errorf("exclusive participation journal: %w", e)
	}
	ok := false
	defer func() {
		if !ok {
			_ = lock.Close()
		}
	}()
	loaded := false
	if st, e := os.Lstat(path); e == nil {
		loaded = true
		if !st.Mode().IsRegular() || st.Mode().Perm()&0077 != 0 || st.Size() > 4<<20 {
			return nil, ErrInvalid
		}
	} else if !errors.Is(e, os.ErrNotExist) {
		return nil, e
	}
	s := &Service{path: path, lock: lock, reader: reader, wallet: wallet, active: map[string]context.CancelFunc{}, data: journal{Version: 2, Generation: 1, Entries: map[string]Entry{}, Slots: map[string]string{}, Requests: map[string]string{}}}
	legacy, e := productstore.Load(path, &s.data)
	if e != nil {
		return nil, e
	}
	if legacy || (s.data.Version != 1 && s.data.Version != 2) || s.data.Generation == 0 || s.data.Generation == math.MaxUint64 || s.data.Entries == nil || s.data.Slots == nil || s.data.Requests == nil || len(s.data.Entries) > 128 || len(s.data.Requests) > 1024 || len(s.data.Slots) != len(s.data.Entries) {
		return nil, ErrInvalid
	}
	for id, entry := range s.data.Entries {
		expectedSlot := slot(entry.Intent)
		if s.data.Version == 1 {
			expectedSlot = slotV1(entry.Intent)
		}
		if id != entry.ID || !reference(id) || !validNetwork(entry.Intent.Network) || !accountaddress.IsCanonical(entry.Intent.Request.Owner) || entry.Binding != bind(encoded(entry.Intent)) || entry.BusinessBinding != business(entry.Intent) || entry.Slot != expectedSlot || entry.Guard != guard(entry.Intent) || s.data.Slots[entry.Slot] != id || !entryState(entry.State) {
			return nil, ErrInvalid
		}
		if entry.Intent.ActionKind != "" {
			kind, raw, e := payload(entry.Intent.Request)
			if e != nil || kind != entry.Intent.ActionKind || !bytes.Equal(raw, entry.Intent.CanonicalPayload) {
				return nil, ErrInvalid
			}
		}
		if entry.PublishAttemptedAt != "" && (entry.State == Prepared || entry.State == Unsupported) {
			return nil, ErrInvalid
		}
		if entry.CancelRequestedAt != "" {
			at, e := time.Parse(time.RFC3339Nano, entry.CancelRequestedAt)
			if e != nil || at.UTC().Format(time.RFC3339Nano) != entry.CancelRequestedAt || entry.State == Prepared || entry.State == Unsupported {
				return nil, ErrInvalid
			}
		}
		if entry.State == Cancelled && (entry.CancelRequestedAt == "" || entry.PublishAttemptedAt != "") {
			return nil, ErrInvalid
		}
		if n, e := integer(entry.Intent.Generation); e != nil || n == 0 || n > s.data.Generation {
			return nil, ErrInvalid
		}
	}
	for request, id := range s.data.Requests {
		if !reference(request) || s.data.Entries[id].ID != id {
			return nil, ErrInvalid
		}
	}
	if s.data.Version == 1 {
		// This is only our own local projection index. Original intents, operation
		// IDs, signatures, UNKNOWN states and first cause remain byte-identical.
		slots := map[string]string{}
		for id, entry := range s.data.Entries {
			key := slot(entry.Intent)
			if _, duplicate := slots[key]; duplicate {
				return nil, ErrInvalid
			}
			entry.Slot = key
			slots[key] = id
			s.data.Entries[id] = entry
		}
		s.data.Slots = slots
		s.data.Version = 2
	}
	if loaded {
		// A new process is a new local metadata session, never restored approval.
		// Explicit user revocation stays stopped. In-flight originals stay UNKNOWN.
		s.data.Generation++
		for id, entry := range s.data.Entries {
			if entry.State == Prepared || entry.State == Unsupported {
				entry.State = Revoked
				entry.UpdatedAt = timestamp()
				s.data.Entries[id] = entry
			}
		}
	}
	if e = s.save(); e != nil {
		return nil, e
	}
	ok = true
	return s, nil
}
func (s *Service) save() error {
	if e := s.lock.Check(); e != nil {
		s.persistErr = e
		s.data.Stopped = true
		return e
	}
	if e := productstore.Save(s.path, s.data); e != nil {
		s.persistErr = e
		s.data.Stopped = true
		return e
	}
	return nil
}
func reference(v string) bool {
	if len(v) == 0 || len(v) > 128 {
		return false
	}
	for _, c := range v {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.' || c == ':') {
			return false
		}
	}
	return true
}
func hexString(s string, n int) bool {
	if len(s) != n || strings.ToLower(s) != s {
		return false
	}
	_, e := hex.DecodeString(s)
	return e == nil
}
func recordID(s string) bool { return hexString(s, 24) }
func transactionHash(s string) bool {
	return len(s) == 66 && strings.HasPrefix(s, "0x") && hexString(s[2:], 64)
}
func integer(s string) (uint64, error) {
	if s == "" || len(s) > 20 || len(s) > 1 && s[0] == '0' {
		return 0, ErrInvalid
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, ErrInvalid
		}
	}
	n, e := strconv.ParseUint(s, 10, 64)
	if e != nil {
		return 0, ErrInvalid
	}
	return n, nil
}
func validNetwork(n Network) bool {
	id, e := integer(n.NativeChainID)
	return e == nil && id > 0 && id <= math.MaxInt64 && hexString(n.Genesis, 64) && hexString(n.NetworkID32, 64) && reference(n.CometChainID)
}
func validateRequest(r Request) error {
	if !reference(r.RequestID) || !accountaddress.IsCanonical(r.Owner) || len(r.ExpiresAt) > 40 {
		return ErrInvalid
	}
	expiry, e := time.Parse(time.RFC3339Nano, r.ExpiresAt)
	if e != nil || !time.Now().Before(expiry) || expiry.After(time.Now().Add(10*time.Minute)) {
		return ErrInvalid
	}
	if _, e = integer(r.FeeCapYNXT); e != nil {
		return e
	}
	switch r.Action {
	case Vote:
		if !reference(r.Proposal) || (r.Choice != "yes" && r.Choice != "no" && r.Choice != "abstain") || r.AmountYNXT != "" || r.Validator != "" || r.DelegationID != "" || r.UnbondingID != "" {
			return ErrInvalid
		}
	case Delegate, Unbond:
		n, e := integer(r.AmountYNXT)
		if e != nil || n == 0 || n > math.MaxInt64 || r.Proposal != "" || r.Choice != "" || r.UnbondingID != "" {
			return ErrInvalid
		}
		if r.Action == Delegate && (!reference(r.Validator) || r.DelegationID != "") || r.Action == Unbond && (!recordID(r.DelegationID) || r.Validator != "") {
			return ErrInvalid
		}
	case Withdraw:
		if !recordID(r.UnbondingID) || r.DelegationID != "" || r.Validator != "" || r.AmountYNXT != "" || r.Proposal != "" || r.Choice != "" {
			return ErrInvalid
		}
	default:
		return ErrUnsupported
	}
	return nil
}
func entryState(v string) bool {
	switch v {
	case Prepared, Unsupported, Unknown, AwaitingWallet, ReportedCommitted, ReportedRejected, Denied, Revoked, Cancelled:
		return true
	}
	return false
}
func payload(r Request) (string, []byte, error) {
	amount, _ := integer(r.AmountYNXT)
	switch r.Action {
	case Delegate:
		b, e := ynxauth.EncodeActionPayload(ynxauth.ActionStakeDelegate, ynxauth.StakeDelegatePayload{Validator: r.Validator, AmountYNXT: amount})
		return ynxauth.ActionStakeDelegate, b, e
	case Unbond:
		b, e := ynxauth.EncodeActionPayload(ynxauth.ActionStakeUnbond, ynxauth.StakeUnbondPayload{DelegationID: r.DelegationID, AmountYNXT: amount})
		return ynxauth.ActionStakeUnbond, b, e
	case Withdraw:
		b, e := ynxauth.EncodeActionPayload(ynxauth.ActionStakeWithdraw, ynxauth.StakeWithdrawPayload{UnbondingID: r.UnbondingID})
		return ynxauth.ActionStakeWithdraw, b, e
	default:
		return "", nil, ErrUnsupported
	}
}
func critical(c Conditions) any {
	base := struct {
		Network                                                                                               Network
		Owner, Action, Policy, Nonce, Fee, Validator, Object, Available, Wait, Commission, Proposal, Snapshot string
		ProposalBinding                                                                                       Binding
	}{c.Network, c.Owner, c.Action, c.PolicyRevision, c.NextNonce, c.FeeYNXT, c.Validator, c.ObjectVersion, c.AvailableYNXT, c.UnbondingSeconds, c.CommissionBPS, c.Proposal, c.SnapshotHeight, c.ProposalBinding}
	if c.Action == Withdraw {
		return struct {
			Original    any
			AvailableAt string
			Ready       bool
		}{base, c.WithdrawAvailableAt, c.NativeAvailable}
	}
	return base
}
func guard(i Intent) string {
	target := i.Request.Validator
	if i.Request.Action == Unbond {
		target = i.Request.DelegationID
	}
	if i.Request.Action == Withdraw {
		target = i.Request.UnbondingID
	}
	if i.Request.Action == Vote {
		target = i.Request.Proposal
	}
	return bind(encoded([]string{i.Network.Genesis, i.Network.NetworkID32, i.Request.Owner, i.Request.Action, target})).SHA512
}
func slot(i Intent) string {
	return bind(encoded(struct {
		Guard      string
		Critical   any
		Generation string
	}{guard(i), critical(i.Conditions), i.Generation})).SHA512
}
func slotV1(i Intent) string {
	return bind(encoded(struct {
		Guard    string
		Critical any
	}{guard(i), critical(i.Conditions)})).SHA512
}
func business(i Intent) Binding {
	r := i.Request
	r.RequestID = ""
	r.ExpiresAt = ""
	return bind(encoded(struct {
		Request    Request
		Critical   any
		Kind       string
		Payload    []byte
		Generation string
	}{r, critical(i.Conditions), i.ActionKind, i.CanonicalPayload, i.Generation}))
}
func walletSupports(c WalletCapabilities, i Intent) bool {
	if !reference(c.Publisher) || c.Network != i.Network || c.Suite != "YNX-BATCH/v0.1" || !c.PublishOriginalNativeAction || !c.LookupOriginalOperation {
		return false
	}
	for _, action := range c.Actions {
		if action == i.ActionKind {
			return true
		}
	}
	return false
}
func cloneEntry(e Entry) Entry {
	e.Intent.CanonicalPayload = append([]byte(nil), e.Intent.CanonicalPayload...)
	if e.WalletResult != nil {
		v := *e.WalletResult
		e.WalletResult = &v
	}
	if e.Observation != nil {
		v := *e.Observation
		e.Observation = &v
	}
	return e
}
func fault(e *Entry, cause error) {
	if cause == nil {
		return
	}
	text := cause.Error()
	if len(text) > 1024 {
		text = text[:1024]
	}
	e.LastError = text
	if e.FirstCause == "" {
		e.FirstCause = text
	}
	e.UpdatedAt = timestamp()
}

func (s *Service) Prepare(ctx context.Context, req Request) (Entry, error) {
	if e := validateRequest(req); e != nil {
		return Entry{}, e
	}
	s.mu.Lock()
	if s.closed || s.data.Stopped {
		s.mu.Unlock()
		return Entry{}, ErrRevoked
	}
	generation := s.data.Generation
	s.mu.Unlock()
	c, e := s.reader.Current(ctx, req)
	if e != nil {
		return Entry{}, e
	}
	if !validNetwork(c.Network) || c.Owner != req.Owner || c.Action != req.Action {
		return Entry{}, ErrInvalid
	}
	i := Intent{Network: c.Network, Request: req, Conditions: c, Generation: strconv.FormatUint(generation, 10)}
	blocked := c.Reason
	if c.NativeAvailable {
		kind, raw, e := payload(req)
		if e != nil {
			return Entry{}, e
		}
		i.ActionKind, i.CanonicalPayload = kind, raw
		fee, e := integer(c.FeeYNXT)
		cap, ec := integer(req.FeeCapYNXT)
		if e != nil || ec != nil || fee > cap {
			return Entry{}, ErrInvalid
		}
		if s.wallet == nil {
			blocked = "Original Wallet publisher/lookup adapter not supplied"
		} else {
			capabilities, err := s.wallet.Capabilities(ctx)
			if err != nil || !walletSupports(capabilities, i) {
				blocked = "Original Wallet exact native action publisher/lookup capability unavailable"
			} else {
				blocked = ""
			}
		}
	} else if blocked == "" {
		blocked = "Original native executor/snapshot capability unavailable"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.data.Stopped || generation != s.data.Generation {
		return Entry{}, ErrRevoked
	}
	if id, ok := s.data.Requests[req.RequestID]; ok {
		old := s.data.Entries[id]
		if old.BusinessBinding != business(i) {
			return cloneEntry(old), ErrConflict
		}
		return cloneEntry(old), resultError(old)
	}
	key := slot(i)
	if id, ok := s.data.Slots[key]; ok {
		old := s.data.Entries[id]
		if old.BusinessBinding != business(i) {
			return cloneEntry(old), ErrConflict
		}
		if len(s.data.Requests) >= 1024 {
			return Entry{}, ErrConflict
		}
		s.data.Requests[req.RequestID] = id
		if e := s.save(); e != nil {
			return cloneEntry(old), e
		}
		return cloneEntry(old), resultError(old)
	}
	for _, old := range s.data.Entries {
		if old.Guard == guard(i) && (old.State == Unknown || old.State == AwaitingWallet) {
			return cloneEntry(old), ErrUnknown
		}
	}
	if len(s.data.Entries) >= 128 || len(s.data.Requests) >= 1024 {
		return Entry{}, ErrConflict
	}
	var token [16]byte
	if _, e = rand.Read(token[:]); e != nil {
		return Entry{}, e
	}
	entry := Entry{ID: hex.EncodeToString(token[:]), Slot: key, Guard: guard(i), Intent: i, Binding: bind(encoded(i)), BusinessBinding: business(i), State: Prepared, CreatedAt: timestamp(), UpdatedAt: timestamp(), BlockedReason: blocked}
	if blocked != "" {
		entry.State = Unsupported
	}
	s.data.Entries[entry.ID] = entry
	s.data.Slots[key] = entry.ID
	s.data.Requests[req.RequestID] = entry.ID
	if e := s.save(); e != nil {
		return cloneEntry(entry), e
	}
	return cloneEntry(entry), resultError(entry)
}
func resultError(e Entry) error {
	if e.State == Cancelled {
		return ErrCancelled
	}
	if e.State == Unsupported {
		return ErrUnsupported
	}
	if e.State == Unknown || e.State == AwaitingWallet {
		return ErrUnknown
	}
	if e.State == Revoked {
		return ErrRevoked
	}
	return nil
}
func (s *Service) Get(id string) (Entry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.data.Entries[id]
	return cloneEntry(e), ok
}
func (s *Service) List() []Entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	v := make([]Entry, 0, len(s.data.Entries))
	for _, e := range s.data.Entries {
		v = append(v, cloneEntry(e))
	}
	return v
}

// Submit persists UNKNOWN before the first publisher call. OperationID never
// changes. Subsequent calls use Reconcile, including response loss and restart.
func (s *Service) Submit(ctx context.Context, id string) (Entry, error) {
	if ctx == nil {
		return Entry{}, ErrInvalid
	}
	s.mu.Lock()
	entry, ok := s.data.Entries[id]
	if !ok {
		s.mu.Unlock()
		return Entry{}, ErrInvalid
	}
	if entry.State == Unknown || entry.State == AwaitingWallet {
		s.mu.Unlock()
		return s.Reconcile(ctx, id)
	}
	if entry.State != Prepared && entry.State != Unsupported {
		s.mu.Unlock()
		return cloneEntry(entry), resultError(entry)
	}
	if s.closed || s.data.Stopped || entry.Intent.Generation != strconv.FormatUint(s.data.Generation, 10) {
		s.mu.Unlock()
		return cloneEntry(entry), ErrRevoked
	}
	s.mu.Unlock()
	if s.wallet == nil {
		return cloneEntry(entry), ErrUnsupported
	}
	if e := validateRequest(entry.Intent.Request); e != nil {
		return cloneEntry(entry), e
	}
	capabilities, e := s.wallet.Capabilities(ctx)
	if e != nil || !walletSupports(capabilities, entry.Intent) {
		return cloneEntry(entry), ErrUnsupported
	}
	fresh, e := s.reader.Current(ctx, entry.Intent.Request)
	if e != nil {
		return cloneEntry(entry), e
	}
	if !fresh.NativeAvailable {
		return cloneEntry(entry), ErrUnsupported
	}
	if bind(encoded(critical(fresh))) != bind(encoded(critical(entry.Intent.Conditions))) {
		return cloneEntry(entry), ErrStale
	}
	s.mu.Lock()
	entry = s.data.Entries[id]
	if s.closed || s.data.Stopped || entry.Intent.Generation != strconv.FormatUint(s.data.Generation, 10) {
		s.mu.Unlock()
		return cloneEntry(entry), ErrRevoked
	}
	if entry.PublishAttemptedAt != "" {
		s.mu.Unlock()
		return s.Reconcile(ctx, id)
	}
	// Cancel may have retired this exact entry while the reader/capability
	// preflight was in flight. A fresh preflight is not a new local decision.
	if entry.CancelRequestedAt != "" || (entry.State != Prepared && entry.State != Unsupported) {
		s.mu.Unlock()
		return cloneEntry(entry), resultError(entry)
	}
	if err := ctx.Err(); err != nil {
		s.mu.Unlock()
		return cloneEntry(entry), err
	}
	for _, old := range s.data.Entries {
		if old.ID != id && old.Guard == entry.Guard && (old.State == Unknown || old.State == AwaitingWallet) {
			s.mu.Unlock()
			return cloneEntry(old), ErrUnknown
		}
	}
	entry.State = Unknown
	entry.PublishAttemptedAt = timestamp()
	entry.BlockedReason = ""
	entry.UpdatedAt = timestamp()
	s.data.Entries[id] = entry
	if e = s.save(); e != nil {
		fault(&entry, e)
		s.data.Entries[id] = entry
		s.mu.Unlock()
		return cloneEntry(entry), e
	}
	op, cancel := context.WithTimeout(ctx, 8*time.Second)
	s.active[id] = cancel
	s.wg.Add(1)
	s.mu.Unlock()
	defer s.finish(id, cancel)
	result, e := s.wallet.Publish(op, id, entry.Intent, entry.Binding)
	return s.consume(op, entry, result, e)
}
func (s *Service) finish(id string, cancel context.CancelFunc) {
	cancel()
	s.mu.Lock()
	delete(s.active, id)
	s.mu.Unlock()
	s.wg.Done()
}
func (s *Service) Reconcile(ctx context.Context, id string) (Entry, error) {
	if ctx == nil {
		return Entry{}, ErrInvalid
	}
	s.mu.Lock()
	entry, ok := s.data.Entries[id]
	if !ok || s.closed {
		s.mu.Unlock()
		return Entry{}, ErrInvalid
	}
	if entry.State != Unknown && entry.State != AwaitingWallet {
		s.mu.Unlock()
		return cloneEntry(entry), resultError(entry)
	}
	if _, busy := s.active[id]; busy {
		s.mu.Unlock()
		return cloneEntry(entry), ErrUnknown
	}
	op, cancel := context.WithTimeout(ctx, 8*time.Second)
	s.active[id] = cancel
	s.wg.Add(1)
	s.mu.Unlock()
	defer s.finish(id, cancel)
	if s.wallet != nil {
		result, e := s.wallet.Lookup(op, id, entry.Binding)
		return s.consume(op, entry, result, e)
	}
	if entry.WalletResult != nil && transactionHash(entry.WalletResult.NativeHash) {
		return s.consume(op, entry, *entry.WalletResult, nil)
	}
	return cloneEntry(entry), ErrUnsupported
}
func (s *Service) consume(ctx context.Context, entry Entry, result WalletResult, remoteErr error) (Entry, error) {
	if remoteErr != nil {
		entry.State = Unknown
		fault(&entry, remoteErr)
	} else if result.OperationID != entry.ID || result.Intent != entry.Binding || len(result.RemoteRef) > 256 || result.NativeHash != "" && !transactionHash(result.NativeHash) || entry.WalletResult != nil && entry.WalletResult.NativeHash != "" && result.NativeHash != entry.WalletResult.NativeHash {
		entry.State = Unknown
		fault(&entry, ErrInvalid)
	} else {
		entry.WalletResult = &result
		switch result.State {
		case "denied":
			if result.NativeHash != "" {
				entry.State = Unknown
				fault(&entry, ErrInvalid)
			} else {
				entry.State = Denied
			}
		case "pending", "submitted", "unknown", "not_found":
			entry.State = Unknown
			if result.State == "pending" && result.NativeHash == "" {
				entry.State = AwaitingWallet
			}
		default:
			entry.State = Unknown
			fault(&entry, ErrInvalid)
		}
		if transactionHash(result.NativeHash) && (result.State == "pending" || result.State == "submitted" || result.State == "unknown" || result.State == "not_found") {
			observation, e := s.reader.ReadResult(ctx, entry.Intent, result.NativeHash)
			if e != nil {
				entry.State = Unknown
				fault(&entry, e)
			} else if observation.NativeHash != result.NativeHash || observation.Source != "comet-rpc" {
				entry.State = Unknown
				fault(&entry, ErrInvalid)
			} else {
				observation.IndependentFinality = false
				entry.Observation = &observation
				switch observation.Status {
				case "committed":
					entry.State = ReportedCommitted
				case "rejected":
					entry.State = ReportedRejected
				default:
					entry.State = Unknown
				}
			}
		}
	}
	entry.UpdatedAt = timestamp()
	s.mu.Lock()
	defer s.mu.Unlock()
	// A callback owns only its original result, never the cancellation metadata
	// recorded while it was awaiting Wallet or the original chain result.
	entry.CancelRequestedAt = s.data.Entries[entry.ID].CancelRequestedAt
	s.data.Entries[entry.ID] = entry
	if e := s.save(); e != nil {
		return cloneEntry(entry), e
	}
	return cloneEntry(entry), resultError(entry)
}

// Revoke seals NEW dispatch and increments its durable local generation. Old
// callbacks may record original outcomes. A submitted chain action is never
// claimed to be cancelled or withdrawn. Reconcile remains read-only and usable.
func (s *Service) Revoke() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return ErrRevoked
	}
	if s.data.Stopped {
		return s.persistErr
	}
	if s.data.Generation == math.MaxUint64 {
		return ErrInvalid
	}
	s.data.Generation++
	s.data.Stopped = true
	for id, e := range s.data.Entries {
		if e.State == Prepared || e.State == Unsupported {
			e.State = Revoked
			e.UpdatedAt = timestamp()
			s.data.Entries[id] = e
		}
	}
	for _, cancel := range s.active {
		cancel()
	}
	return s.save()
}
func (s *Service) Close() error {
	s.mu.Lock()
	if s.closed {
		e := s.persistErr
		s.mu.Unlock()
		return e
	}
	s.closed = true
	// Normal process close is not an explicit user revoke. Advance the local
	// generation and retire old prepared metadata, while keeping new sessions
	// possible. UNKNOWN can only reconcile its existing original operation.
	if !s.data.Stopped {
		if s.data.Generation == math.MaxUint64 {
			s.data.Stopped = true
			s.persistErr = ErrInvalid
		} else {
			s.data.Generation++
		}
	}
	for id, entry := range s.data.Entries {
		if entry.State == Prepared || entry.State == Unsupported {
			entry.State = Revoked
			entry.UpdatedAt = timestamp()
			s.data.Entries[id] = entry
		}
	}
	for _, cancel := range s.active {
		cancel()
	}
	s.mu.Unlock()
	s.wg.Wait()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.persistErr != nil {
		return s.persistErr
	}
	if e := s.save(); e != nil {
		return e
	}
	return s.lock.Close()
}
