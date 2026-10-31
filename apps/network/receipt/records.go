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

// ClientReceipt keeps the original computed view and untrusted RPC report.
// Loading it is historical readback only, never verification against new trust.
type ClientReceipt struct {
	ReceiptID        string          `json:"receiptId"`
	TxID             string          `json:"txId"`
	ObservedAt       string          `json:"observedAt"`
	ContextPin       string          `json:"contextPin"`
	View             json.RawMessage `json:"view"`
	Report           json.RawMessage `json:"report,omitempty"`
	ReportText       string          `json:"reportText,omitempty"`
	ReportCollection json.RawMessage `json:"reportCollection,omitempty"`
	ReportedBy       string          `json:"reportedBy,omitempty"`
	ProofCollection  json.RawMessage `json:"proofCollection,omitempty"`
}
type ReceiptSummary struct {
	ReceiptID     string `json:"receiptId"`
	TxID          string `json:"txId"`
	ObservedAt    string `json:"observedAt"`
	ReportedLevel string `json:"reportedLevel"`
}
type receiptSnapshot struct {
	Version int `json:"version"`
	// Compact records are byte strings in the envelope. Deep upstream JSON
	// cannot multiply indentation space or memory during durable snapshotting.
	Records map[string][]byte `json:"records"`
}
type ReceiptStore struct {
	mu      sync.Mutex
	path    string
	records map[string]ClientReceipt
	lock    *localstore.Lock
	closed  bool
}

func clientReceiptID(r ClientReceipt) string {
	r.ReceiptID = ""
	b, _ := json.Marshal(r)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
func validClientReceipt(r ClientReceipt) bool {
	var v ProofView
	if json.Unmarshal(r.View, &v) != nil || v.TxID != r.TxID {
		return false
	}
	if r.ReportText != "" {
		var raw json.RawMessage = []byte(r.ReportText)
		a, err := json.Marshal(raw)
		if err != nil {
			return false
		}
		b, err := json.Marshal(r.Report)
		if err != nil || string(a) != string(b) {
			return false
		}
	}
	return validObservation(Observation{TxID: r.TxID, Height: v.Height, ReportedLevel: v.Level, Source: v.Source, ContextPin: r.ContextPin, ObservedAt: r.ObservedAt}) &&
		len(r.ReportedBy) <= 4096 && (len(r.Report) == 0 || json.Valid(r.Report)) && (len(r.ReportCollection) == 0 || json.Valid(r.ReportCollection)) && (len(r.ProofCollection) == 0 || json.Valid(r.ProofCollection))
}
func cloneClientReceipt(r ClientReceipt) ClientReceipt {
	r.View = append(json.RawMessage(nil), r.View...)
	r.Report = append(json.RawMessage(nil), r.Report...)
	r.ReportCollection = append(json.RawMessage(nil), r.ReportCollection...)
	r.ProofCollection = append(json.RawMessage(nil), r.ProofCollection...)
	return r
}

// The separate file preserves the existing metadata history schema unchanged.
func OpenReceiptStore(path string) (*ReceiptStore, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, errors.New("absolute receipt store path required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	if i, err := os.Lstat(filepath.Dir(path)); err != nil || !i.IsDir() || i.Mode()&os.ModeSymlink != 0 || i.Mode().Perm()&0077 != 0 {
		return nil, errors.New("private receipt directory required")
	}
	lock, err := localstore.Acquire(path + ".owner.lock")
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			_ = lock.Close()
		}
	}()
	if i, err := os.Lstat(path); err == nil {
		if !i.Mode().IsRegular() || i.Mode().Perm()&0077 != 0 || i.Size() > 32<<20 {
			return nil, errors.New("unsafe receipt store")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	s := receiptSnapshot{Version: 1, Records: map[string][]byte{}}
	legacy, err := productstore.Load(path, &s)
	if err != nil {
		return nil, err
	}
	if legacy || s.Version != 1 || s.Records == nil || len(s.Records) > 256 {
		return nil, errors.New("invalid receipt store")
	}
	records := make(map[string]ClientReceipt, len(s.Records))
	total := 0
	for id, raw := range s.Records {
		total += len(raw)
		if total > 8<<20 {
			return nil, errors.New("receipt capacity exceeded")
		}
		var r ClientReceipt
		if json.Unmarshal(raw, &r) != nil {
			return nil, errors.New("invalid stored receipt")
		}
		if id != r.ReceiptID || id != clientReceiptID(r) || !validClientReceipt(r) {
			return nil, errors.New("invalid original receipt record")
		}
		records[id] = r
	}
	ok = true
	return &ReceiptStore{path: path, records: records, lock: lock}, nil
}

func (s *ReceiptStore) Save(r ClientReceipt) (ClientReceipt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return ClientReceipt{}, errors.New("receipt store closed")
	}
	if r.ObservedAt == "" {
		r.ObservedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	// json.Marshal compacts RawMessage without converting numbers or keys.
	canonical, err := json.Marshal(r)
	if err != nil {
		return ClientReceipt{}, err
	}
	if err = json.Unmarshal(canonical, &r); err != nil {
		return ClientReceipt{}, err
	}
	r.ReceiptID = clientReceiptID(r)
	if !validClientReceipt(r) {
		return ClientReceipt{}, errors.New("invalid receipt")
	}
	if old, ok := s.records[r.ReceiptID]; ok {
		return cloneClientReceipt(old), nil
	}
	if len(s.records) >= 256 {
		return ClientReceipt{}, errors.New("receipt capacity reached; original records preserved")
	}
	next := make(map[string]ClientReceipt, len(s.records)+1)
	for k, v := range s.records {
		next[k] = v
	}
	next[r.ReceiptID] = cloneClientReceipt(r)
	snap := receiptSnapshot{1, make(map[string][]byte, len(next))}
	total := 0
	for id, value := range next {
		raw, err := json.Marshal(value)
		if err != nil {
			return ClientReceipt{}, err
		}
		total += len(raw)
		if total > 8<<20 {
			return ClientReceipt{}, errors.New("receipt capacity reached; original records preserved")
		}
		snap.Records[id] = raw
	}
	if err := s.lock.Check(); err != nil {
		return ClientReceipt{}, err
	}
	if err := productstore.Save(s.path, snap); err != nil {
		return ClientReceipt{}, err
	}
	s.records = next
	return cloneClientReceipt(r), nil
}
func (s *ReceiptStore) Get(id string) (ClientReceipt, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.records[id]
	return cloneClientReceipt(r), ok
}
func (s *ReceiptStore) List() []ReceiptSummary {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]ReceiptSummary, 0, len(s.records))
	for _, r := range s.records {
		var v ProofView
		_ = json.Unmarshal(r.View, &v)
		out = append(out, ReceiptSummary{r.ReceiptID, r.TxID, r.ObservedAt, v.Level})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ObservedAt > out[j].ObservedAt })
	return out
}
func (s *ReceiptStore) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	return s.lock.Close()
}
