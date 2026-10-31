//go:build pay_pq && pay_cloud

package payproduct

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
)

// This adapter implements Cloud's actual original interface. It may use the
// private HTTP client or the same original in-process producer; never a legacy
// invoice, signing key or raw Cloud bill as an authority.
type CloudNativeInvoiceProducer struct{ producer NativeInvoiceIntentProducer }

var _ cloud.IDEUsageInvoiceProducer = (*CloudNativeInvoiceProducer)(nil)

func NewCloudNativeInvoiceProducer(producer NativeInvoiceIntentProducer) (*CloudNativeInvoiceProducer, error) {
	if producer == nil {
		return nil, ErrNativePayUnavailable
	}
	return &CloudNativeInvoiceProducer{producer}, nil
}
func cloudNativeIntent(r cloud.IDEUsageInvoiceRequest) (NativeInvoiceProductIntent, error) {
	raw, err := json.Marshal(r)
	if err != nil {
		return NativeInvoiceProductIntent{}, err
	}
	if r.BillID == "" || r.RequestID == "" || r.InstanceID == "" || r.Period == "" || r.ScheduleID == "" || r.ScheduleRevision == "" || r.RegistrationRef == "" || r.ApprovalRef == "" {
		return NativeInvoiceProductIntent{}, errors.New("complete original priced/sealed Cloud bill required")
	}
	return NativeInvoiceProductIntent{ProductID: "cloud.ide-usage", SourceOrder: r.BillID, Merchant: r.Merchant, Recipient: r.Recipient, Genesis: r.Asset.Genesis, NativeChainID: r.Asset.NativeChainID, AssetID: r.Asset.AssetID, UnitVersion: r.Asset.UnitVersion, AmountAtoms: r.Atoms, DomainData: raw}, nil
}
func (p *CloudNativeInvoiceProducer) CreateUsageInvoice(ctx context.Context, r cloud.IDEUsageInvoiceRequest, current func() error) (cloud.IDEUsageInvoiceResult, error) {
	input, err := cloudNativeIntent(r)
	if err != nil {
		return cloud.IDEUsageInvoiceResult{}, err
	}
	view, err := p.producer.CreateInvoiceIntent(ctx, input, current)
	if err != nil {
		return cloud.IDEUsageInvoiceResult{}, err
	}
	return cloudNativeResult(r, input, view)
}
func (p *CloudNativeInvoiceProducer) LookupUsageInvoice(ctx context.Context, r cloud.IDEUsageInvoiceRequest) (cloud.IDEUsageInvoiceResult, error) {
	input, err := cloudNativeIntent(r)
	if err != nil {
		return cloud.IDEUsageInvoiceResult{}, err
	}
	view, err := p.producer.LookupInvoiceIntent(ctx, input)
	if err != nil {
		return cloud.IDEUsageInvoiceResult{}, err
	}
	return cloudNativeResult(r, input, view)
}
func cloudNativeResult(r cloud.IDEUsageInvoiceRequest, input NativeInvoiceProductIntent, view NativeInvoiceIntentView) (cloud.IDEUsageInvoiceResult, error) {
	if err := validateNativeIntentReply(input, view); err != nil {
		return cloud.IDEUsageInvoiceResult{}, err
	}
	return cloud.IDEUsageInvoiceResult{Request: r, InvoiceID: view.Terms.InvoiceID, OriginalOperation: view.OriginalOperation, State: view.State}, nil
}
