package contribution

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productstore"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// ResourceIdentity names one original P09 resource incarnation. It is DATA,
// never an issuer registration, Source lease, signing-key epoch or permission.
// The actual protected publisher must bind these identities independently.
// No browser/Native IPC operation may initialize or replace this identity.
type ResourceIdentity struct {
	SourceID    string `json:"sourceId"`
	InstanceID  string `json:"instanceId"`
	ResourceKey string `json:"resourceKey"`
}

type resourceCurrentState struct {
	Identity     ResourceIdentity `json:"identity"`
	Epoch        string           `json:"epoch"`
	Sequence     string           `json:"sequence"`
	PreviousHead string           `json:"previousHead"`
	Head         string           `json:"head"`
}

// ResourceCurrentDATA is exactly the nine original resource-current DATA
// fields. Auth/sole SDK own its registered issuer, exact frame and signature.
// Local JSON/head consistency is not anti-rollback Root or Source admission.
type ResourceCurrentDATA struct {
	SourceID    string `json:"sourceId"`
	InstanceID  string `json:"instanceId"`
	ResourceKey string `json:"resourceKey"`
	Epoch       string `json:"epoch"`
	Sequence    string `json:"sequence"`
	Head        string `json:"head"`
	Status      string `json:"status"`
	IssuedAtMS  int64  `json:"issuedAtMs"`
	ExpiresAtMS int64  `json:"expiresAtMs"`
}

var ErrResourceCurrent = errors.New("original resource current DATA unavailable or inconsistent")

const currentResourceTTL = 20 * time.Second

func resourceIdentityValid(v ResourceIdentity) bool {
	for _, value := range []string{v.SourceID, v.InstanceID, v.ResourceKey} {
		if len(value) == 0 || len(value) > 256 || !utf8.ValidString(value) || strings.IndexFunc(value, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0 {
			return false
		}
	}
	return true
}
func currentCounter(value string) (uint64, error) {
	n, err := strconv.ParseUint(value, 10, 64)
	if err != nil || n == 0 || strconv.FormatUint(n, 10) != value {
		return 0, ErrResourceCurrent
	}
	return n, nil
}
func resourceHeadValid(s string) bool {
	raw, e := hex.DecodeString(s)
	return e == nil && len(raw) == 32 && hex.EncodeToString(raw) == s
}
func resourceCurrentHead(data journal) (string, error) {
	v := data.ResourceCurrent
	if v == nil {
		return "", ErrResourceCurrent
	}
	// Deterministic original-store commitment: sorted JSON map keys and precise
	// Go integers; no frontend snapshot, Source floor or issuer key generation.
	raw, err := json.Marshal(struct {
		Domain       string            `json:"domain"`
		Version      int               `json:"version"`
		Identity     ResourceIdentity  `json:"identity"`
		Epoch        string            `json:"epoch"`
		Sequence     string            `json:"sequence"`
		PreviousHead string            `json:"previousHead"`
		Jobs         map[string]Record `json:"jobs"`
		Nonces       map[string]string `json:"nonces"`
	}{"YNX-NETWORK-ORIGINAL-RESOURCE-STATE/v1", data.Version, v.Identity, v.Epoch, v.Sequence, v.PreviousHead, data.Jobs, data.Nonces})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}
func validateResourceCurrent(data journal) error {
	v := data.ResourceCurrent
	if v == nil {
		return nil
	}
	if !resourceIdentityValid(v.Identity) || !resourceHeadValid(v.Head) || !resourceHeadValid(v.PreviousHead) {
		return ErrResourceCurrent
	}
	if _, err := currentCounter(v.Epoch); err != nil {
		return err
	}
	if _, err := currentCounter(v.Sequence); err != nil {
		return err
	}
	head, err := resourceCurrentHead(data)
	if err != nil || head != v.Head {
		return ErrResourceCurrent
	}
	return nil
}

func (r *Runner) resourceDiskUnchanged() error {
	var disk journal
	legacy, err := productstore.Load(r.path, &disk)
	if err != nil || legacy {
		return ErrResourceCurrent
	}
	a, err := json.Marshal(r.data)
	if err != nil {
		return err
	}
	b, err := json.Marshal(disk)
	if err != nil || !bytes.Equal(a, b) {
		return ErrResourceCurrent
	}
	return nil
}

// InitializeCurrentResource binds only local original-store identity, once.
// The resource epoch starts at its OWN creation (1); every actual store commit
// advances its OWN full-u64 sequence. It never accepts a supplied epoch, floor,
// head, sequence or purported registration. Existing unrelated journals and
// resource identities are not adopted/rebound. Production stays disabled.
func (r *Runner) InitializeCurrentResource(ctx context.Context, identity ResourceIdentity) error {
	if r == nil || !resourceIdentityValid(identity) {
		return ErrResourceCurrent
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if r.closed || r.persistenceErr != nil {
		return ErrResourceCurrent
	}
	if err := r.lock.Check(); err != nil {
		return err
	}
	if err := r.resourceDiskUnchanged(); err != nil {
		return err
	}
	if r.data.ResourceCurrent != nil {
		if r.data.ResourceCurrent.Identity != identity {
			return ErrResourceCurrent
		}
		return validateResourceCurrent(r.data)
	}
	// A new resource registration cannot silently relabel prior work/nonce data.
	if len(r.data.Jobs) != 0 || len(r.data.Nonces) != 0 {
		return ErrResourceCurrent
	}
	r.data.ResourceCurrent = &resourceCurrentState{Identity: identity, Epoch: "1", Sequence: "0", PreviousHead: strings.Repeat("0", 64), Head: strings.Repeat("0", 64)}
	return r.persist()
}

// advanceResourceCurrent runs under the SAME original Runner mutex and the
// SAME productstore transaction as work/nonce/usage changes. A failed write
// poisons future current reads until an actual cold original-store recovery.
func (r *Runner) advanceResourceCurrent() error {
	v := r.data.ResourceCurrent
	if v == nil {
		return nil
	}
	n, err := strconv.ParseUint(v.Sequence, 10, 64)
	if err != nil || strconv.FormatUint(n, 10) != v.Sequence || n == math.MaxUint64 {
		return ErrResourceCurrent
	}
	next := *v
	next.PreviousHead = v.Head
	next.Sequence = strconv.FormatUint(n+1, 10)
	r.data.ResourceCurrent = &next
	head, err := resourceCurrentHead(r.data)
	if err != nil {
		return err
	}
	next.Head = head
	return nil
}

// ReadCurrentResourceDATA reads one controlled, consistent resource snapshot.
// It performs no registration/signature/claim, never accepts caller counters,
// and cannot activate a Runner. Root-selected transport is not authority.
func (r *Runner) ReadCurrentResourceDATA(ctx context.Context) (ResourceCurrentDATA, error) {
	if r == nil {
		return ResourceCurrentDATA{}, ErrResourceCurrent
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return ResourceCurrentDATA{}, err
	}
	if r.closed || r.persistenceErr != nil || r.data.ResourceCurrent == nil {
		return ResourceCurrentDATA{}, ErrResourceCurrent
	}
	if err := r.lock.Check(); err != nil {
		return ResourceCurrentDATA{}, err
	}
	if err := validateResourceCurrent(r.data); err != nil {
		return ResourceCurrentDATA{}, err
	}
	if err := r.resourceDiskUnchanged(); err != nil {
		return ResourceCurrentDATA{}, err
	}
	now := time.Now().UnixMilli()
	expires := now + currentResourceTTL.Milliseconds()
	if now < 0 || expires > 9007199254740991 {
		return ResourceCurrentDATA{}, ErrResourceCurrent
	}
	v := r.data.ResourceCurrent
	result := ResourceCurrentDATA{v.Identity.SourceID, v.Identity.InstanceID, v.Identity.ResourceKey, v.Epoch, v.Sequence, v.Head, "active", now, expires}
	if err := ctx.Err(); err != nil {
		return ResourceCurrentDATA{}, err
	}
	return result, nil
}
