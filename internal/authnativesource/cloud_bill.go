//go:build pay_pq

package paynativesource

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
)

// Private selection expectation, not a public Cloud locator/Pay grant DTO.
// Exact shared field names remain sole SDK-owned. Cloud owner is never used
// as a Pay principal. All original metadata must agree with the signed scope.
type originalCloudBillLocator struct {
	Owner          string                   `json:"owner"`
	RequestID      string                   `json:"requestId"`
	Period         string                   `json:"period"`
	ProjectID      string                   `json:"projectId"`
	ProjectRef     cloud.IDEDeploymentV2Ref `json:"projectRef"`
	ResourceID     string                   `json:"resourceId"`
	ManifestSHA256 string                   `json:"manifestSHA256"`
	ArtifactSHA256 string                   `json:"artifactSHA256"`
}
type heldOriginalCloudBill struct {
	provenance *cloud.IDEUsageBillProvenance
	data       cloud.IDEUsageBillProvenanceDATA
	digest     string
	until      time.Time
	ready      atomic.Bool
	closeOnce  sync.Once
	closeFirst error
}

func (h *heldOriginalCloudBill) close() error {
	if h == nil {
		return nil
	}
	h.closeOnce.Do(func() {
		if h.provenance != nil {
			h.closeFirst = h.provenance.Close()
		}
	})
	return h.closeFirst
}
func (l *requestLease) heldCloudCurrent() error {
	l.cloudMu.Lock()
	if l.cloudClosed {
		l.cloudMu.Unlock()
		return ErrDenied
	}
	held := make([]*heldOriginalCloudBill, 0, len(l.cloudHeld))
	for _, h := range l.cloudHeld {
		held = append(held, h)
	}
	l.cloudMu.Unlock()
	for _, h := range held {
		if h == nil || h.provenance == nil || !h.ready.Load() || !l.before(h.until) {
			return ErrDenied
		}
		// This original P04 callee is explicitly no IO/no journal/Pay Store lock.
		if e := h.provenance.Current(); e != nil {
			return e
		}
	}
	return nil
}
func (l *requestLease) closeCloudHeld() error {
	l.cloudMu.Lock()
	l.cloudClosed = true
	held := make([]*heldOriginalCloudBill, 0, len(l.cloudHeld))
	for _, h := range l.cloudHeld {
		held = append(held, h)
	}
	l.cloudMu.Unlock()
	for _, h := range held {
		if e := h.close(); e != nil {
			l.cloudMu.Lock()
			if l.cloudCloseFirst == nil {
				l.cloudCloseFirst = e
			}
			l.cloudMu.Unlock()
		}
	}
	l.cloudMu.Lock()
	defer l.cloudMu.Unlock()
	return l.cloudCloseFirst
}

func (l *requestLease) holdCloudBill(ctx context.Context, b *originalBill) (*heldOriginalCloudBill, error) {
	if l == nil || b == nil || ctx == nil || l.owner == nil || l.owner.runtime == nil || l.owner.runtime.cloudBills == nil || b.intent.ProductID != "cloud.ide-usage" {
		return nil, errors.New("PAY_ORIGINAL_CLOUD_BILL_READER_REQUIRED")
	}
	// Capture serialization is separate from Current's inventory lock. Current
	// never waits behind journal IO, including when P06 holds its Store lock.
	l.cloudCaptureMu.Lock()
	defer l.cloudCaptureMu.Unlock()
	l.cloudMu.Lock()
	existing := l.cloudHeld[b.intent.SourceOrder]
	closed := l.cloudClosed
	l.cloudMu.Unlock()
	if closed || !l.active.Load() {
		return nil, ErrDenied
	}
	if existing != nil {
		if existing.provenance == nil || !existing.ready.Load() {
			return existing, ErrDenied
		}
		return existing, existing.provenance.Current() // never recapture expired/UNKNOWN
	}
	original := b.cloudOriginal
	if original.Owner == "" || original.RequestID == "" || original.Period == "" || original.ProjectID == "" || original.ResourceID == "" || len(original.ManifestSHA256) != 64 || len(original.ArtifactSHA256) != 64 {
		return nil, ErrDenied
	}
	provenance, e := l.owner.runtime.cloudBills.Capture(ctx, original.Owner, original.RequestID, original.Period)
	h := &heldOriginalCloudBill{provenance: provenance}
	// Adopt nullable partial before its error, DATA or any post-current check.
	l.cloudMu.Lock()
	if l.cloudHeld == nil {
		l.cloudHeld = make(map[string]*heldOriginalCloudBill)
	}
	l.cloudHeld[b.intent.SourceOrder] = h
	closed = l.cloudClosed
	l.cloudMu.Unlock()
	if closed || !l.active.Load() {
		_ = h.close()
		return h, ErrDenied
	}
	if e != nil {
		return h, e
	}
	if provenance == nil {
		return h, ErrDenied
	}
	h.data, e = provenance.DATA()
	if e != nil {
		return h, e
	}
	h.digest, e = provenance.SHA256()
	if e != nil {
		return h, e
	}
	h.until = provenance.Until()
	d := h.data
	request := d.Bill.Request
	raw, e := json.Marshal(request)
	if e != nil || d.Owner != original.Owner || d.ProjectID != original.ProjectID || d.ProjectRef != original.ProjectRef || d.ResourceID != original.ResourceID || d.ManifestSHA256 != original.ManifestSHA256 || d.ArtifactSHA256 != original.ArtifactSHA256 || request.RequestID != original.RequestID || request.Period != original.Period || request.BillID != b.intent.SourceOrder || request.Merchant != b.merchant || request.Recipient != b.terms.Recipient || request.Asset.Genesis != b.intent.Genesis || request.Asset.NativeChainID != b.intent.NativeChainID || request.Asset.AssetID != b.intent.AssetID || request.Asset.UnitVersion != b.intent.UnitVersion || request.Atoms != b.intent.AmountAtoms || !bytes.Equal(raw, b.intent.DomainData) || d.Bill.State == "NO_CHARGE" || request.Atoms == "0" || !l.before(h.until) {
		return h, ErrDenied
	}
	// Retain the actual state/OriginalOperation, including UNKNOWN. There is no
	// reserve, confirm, lookup, resubmit, new terms or replay in this reader.
	if e = provenance.Current(); e != nil {
		return h, e
	}
	h.ready.Store(true)
	return h, nil
}
