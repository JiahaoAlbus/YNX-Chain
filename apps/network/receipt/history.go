package receipt

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/internal/localstore"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productstore"
)

// History is a private local projection, never a trust anchor or replay permit.
// Reopening it does not reauthenticate a prior height against today's trust.
type History struct {
	mu      sync.Mutex
	path    string
	records map[string]Observation
	closed  bool
	lock    *localstore.Lock
}
type Observation struct {
	TxID          string `json:"txId"`
	Height        string `json:"height"`
	ReportedLevel string `json:"reportedLevel"`
	Source        string `json:"source"`
	ContextPin    string `json:"contextPin"`
	ObservedAt    string `json:"observedAt"`
	Historical    bool   `json:"historical"`
}
type historySnapshot struct {
	Version int                    `json:"version"`
	Records map[string]Observation `json:"records"`
}

func OpenHistory(path string) (*History, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, errors.New("absolute local history path required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	if info, err := os.Lstat(filepath.Dir(path)); err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("private history directory required")
	}
	owner := path + ".owner"
	if _, err := os.Lstat(owner); err == nil {
		return nil, errors.New("legacy local history owner preserved")
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	lock, err := localstore.Acquire(owner + ".lock")
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			lock.Close()
		}
	}()
	if info, err := os.Lstat(path); err == nil {
		if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 4<<20 {
			return nil, errors.New("unsafe history file")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	s := historySnapshot{Version: 1, Records: map[string]Observation{}}
	legacy, err := productstore.Load(path, &s)
	if err != nil {
		return nil, err
	}
	if legacy || s.Version != 1 || s.Records == nil || len(s.Records) > 2048 {
		return nil, errors.New("invalid local history")
	}
	for key, value := range s.Records {
		if key != observationID(value) || !validObservation(value) {
			return nil, errors.New("invalid historical observation")
		}
		value.Historical = true
		s.Records[key] = value
	}
	ok = true
	return &History{path: path, records: s.Records, lock: lock}, nil
}
func validObservation(v Observation) bool {
	if _, err := hashBytes(v.TxID); err != nil {
		return false
	}
	if len(v.Height) > 20 || len(v.Source) > 4096 || len(v.ContextPin) > 64 {
		return false
	}
	if _, err := time.Parse(time.RFC3339Nano, v.ObservedAt); err != nil {
		return false
	}
	return v.ReportedLevel == RPCOnly || v.ReportedLevel == HeaderVerified || v.ReportedLevel == InclusionVerified || v.ReportedLevel == StateVerified
}
func observationID(v Observation) string {
	b, _ := json.Marshal([]string{v.TxID, v.Height, v.ReportedLevel, v.ContextPin})
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// Observe stores metadata of this computation, not a claim that it was delivered
// or that any account/payment state is currently valid. No proof bytes or host
// credentials are persisted. Duplicate observations occupy one semantic entry.
func (h *History) Observe(v ProofView, pin string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return errors.New("history closed")
	}
	o := Observation{TxID: v.TxID, Height: v.Height, ReportedLevel: v.Level, Source: v.Source, ContextPin: pin, ObservedAt: time.Now().UTC().Format(time.RFC3339Nano), Historical: true}
	if !validObservation(o) {
		return errors.New("invalid observation")
	}
	key := observationID(o)
	if _, exists := h.records[key]; !exists && len(h.records) >= 2048 {
		return errors.New("history capacity reached")
	}
	next := make(map[string]Observation, len(h.records)+1)
	for k, v := range h.records {
		next[k] = v
	}
	next[key] = o
	payload, err := json.Marshal(historySnapshot{1, next})
	if err != nil {
		return err
	}
	if len(payload) > 1<<20 {
		return errors.New("private history capacity reached; preserve existing observations")
	}
	if err := h.lock.Check(); err != nil {
		return err
	}
	if err := productstore.Save(h.path, historySnapshot{1, next}); err != nil {
		return err
	}
	h.records = next
	return nil
}
func (h *History) List() []Observation {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]Observation, 0, len(h.records))
	for _, v := range h.records {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ObservedAt > out[j].ObservedAt })
	return out
}
func (h *History) Close() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil
	}
	h.closed = true
	return h.lock.Close()
}
