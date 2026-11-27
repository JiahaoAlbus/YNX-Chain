package payproduct

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// One original Pay provider, original merchant/key/intent and original Store.
// It adds admission and durable response-loss recovery, never a second account.
type merchantGuardedPay struct {
	original      PayAPI
	service, base *Service
	admission     *merchantAdmission
}

func merchantProviderMutation[T any](p *merchantGuardedPay, ctx context.Context, operation, key string, args any, send func() (T, error)) (T, error) {
	var zero T
	raw, err := json.Marshal(args)
	if err != nil {
		return zero, err
	}
	sum := sha256.Sum256(raw)
	digest := hex.EncodeToString(sum[:])
	id := hashString("YNX_MERCHANT_PROVIDER_DISPATCH_V2", p.admission.merchantID, operation, key)
	var previous BusinessDispatchRecord
	err = p.service.store.Update(func(data *Snapshot) error {
		if data.BusinessDispatches == nil {
			data.BusinessDispatches = map[string]BusinessDispatchRecord{}
		}
		if old, ok := data.BusinessDispatches[id]; ok {
			if old.RequestHash != digest || old.Account != p.admission.account || old.SessionBinding != p.admission.binding || old.MerchantID != p.admission.merchantID || old.Operation != operation || old.IdempotencyKey != key {
				return merchantDenied("PROVIDER_REQUEST_BINDING_MISMATCH", 409)
			}
			previous = old
			return nil
		}
		data.BusinessDispatches[id] = BusinessDispatchRecord{SessionBinding: p.admission.binding, Account: p.admission.account, MerchantID: p.admission.merchantID, RequestHash: digest, Operation: operation, IdempotencyKey: key, Phase: "dispatching", UpdatedAt: p.base.now().UTC()}
		return nil
	})
	if err != nil {
		return zero, err
	}
	if previous.Phase != "" {
		if previous.Phase != "response_received" || previous.ResultCipher == "" {
			return zero, merchantDenied("PROVIDER_OUTCOME_RECOVERY_REQUIRED", 409)
		}
		result, err := p.base.open(previous.ResultCipher)
		if err != nil || strictJSON([]byte(result), &zero) != nil {
			return zero, merchantDenied("PROVIDER_RECEIPT_RECOVERY_REQUIRED", 409)
		}
		return zero, nil
	}
	// Recheck the current authority/member after durable reservation and before
	// dispatch. If it changed, keep the original reservation; do not resend later.
	err = p.service.store.View(func(Snapshot) error { return ctx.Err() })
	if err != nil {
		return zero, err
	}
	result, sendErr := send()
	// Retain only the exact previously reserved result even after logout/expiry.
	// This archival write grants no authority, marks no invoice paid, and cannot
	// create a replacement dispatch. Original Store integrity/seal is reused.
	saveErr := p.base.store.Update(func(data *Snapshot) error {
		old, ok := data.BusinessDispatches[id]
		if !ok || old.RequestHash != digest || old.Account != p.admission.account || old.SessionBinding != p.admission.binding || old.Phase != "dispatching" {
			return errors.New("original provider reservation changed")
		}
		old.Phase = "recovery_required"
		old.UpdatedAt = p.base.now().UTC()
		if sendErr == nil {
			encoded, err := json.Marshal(result)
			if err != nil {
				return err
			}
			old.ResultCipher = p.base.seal(string(encoded))
			old.Phase = "response_received"
		}
		data.BusinessDispatches[id] = old
		return nil
	})
	if saveErr != nil {
		return zero, merchantDenied("PROVIDER_RECEIPT_RECOVERY_REQUIRED", 409)
	}
	if sendErr != nil {
		return zero, merchantDenied("PROVIDER_OUTCOME_RECOVERY_REQUIRED", 409)
	}
	if err := p.service.store.View(func(Snapshot) error { return ctx.Err() }); err != nil {
		return zero, err
	}
	return result, nil
}
func (p *merchantGuardedPay) CreateIntent(ctx context.Context, merchant, payout string, amount int64, key string) (chain.PayIntent, error) {
	return merchantProviderMutation(p, ctx, "intent.create", key, []any{merchant, payout, amount, key}, func() (chain.PayIntent, error) { return p.original.CreateIntent(ctx, merchant, payout, amount, key) })
}
func (p *merchantGuardedPay) CreateInvoice(ctx context.Context, intent string, hours int64, key string) (chain.Invoice, error) {
	return merchantProviderMutation(p, ctx, "invoice.create", key, []any{intent, hours, key}, func() (chain.Invoice, error) { return p.original.CreateInvoice(ctx, intent, hours, key) })
}
func (p *merchantGuardedPay) Settle(ctx context.Context, id, payer, tx, key string) (chain.PaySettlement, error) {
	return merchantProviderMutation(p, ctx, "settlement.submit", key, []any{id, payer, tx, key}, func() (chain.PaySettlement, error) { return p.original.Settle(ctx, id, payer, tx, key) })
}
func (p *merchantGuardedPay) CreateRefund(ctx context.Context, intent string, amount int64, reason, key string) (chain.RefundRecord, error) {
	return merchantProviderMutation(p, ctx, "refund.create", key, []any{intent, amount, reason, key}, func() (chain.RefundRecord, error) { return p.original.CreateRefund(ctx, intent, amount, reason, key) })
}
func (p *merchantGuardedPay) Invoice(ctx context.Context, id string) (chain.Invoice, error) {
	if err := p.service.store.View(func(Snapshot) error { return ctx.Err() }); err != nil {
		return chain.Invoice{}, err
	}
	out, err := p.original.Invoice(ctx, id)
	if err != nil {
		return out, err
	}
	if err = p.service.store.View(func(Snapshot) error { return ctx.Err() }); err != nil {
		return chain.Invoice{}, err
	}
	return out, nil
}
func (p *merchantGuardedPay) Settlement(ctx context.Context, id string) (chain.PaySettlement, error) {
	if err := p.service.store.View(func(Snapshot) error { return ctx.Err() }); err != nil {
		return chain.PaySettlement{}, err
	}
	out, err := p.original.Settlement(ctx, id)
	if err != nil {
		return out, err
	}
	if err = p.service.store.View(func(Snapshot) error { return ctx.Err() }); err != nil {
		return chain.PaySettlement{}, err
	}
	return out, nil
}

// Preserve the original authorized refund capability through the same scoped
// provider wrapper. A Merchant admission still cannot replace Wallet approval.
func (p *merchantGuardedPay) CreateAuthorizedRefund(ctx context.Context, input AuthorizedRefundSubmission) (chain.RefundRecord, error) {
	api, ok := p.original.(AuthorizedRefundAPI)
	if !ok {
		return chain.RefundRecord{}, errors.New("authoritative refund transaction API is unavailable")
	}
	return merchantProviderMutation(p, ctx, "refund.authorized", input.IdempotencyKey, input, func() (chain.RefundRecord, error) { return api.CreateAuthorizedRefund(ctx, input) })
}

// Recover only a response already retained by the original scoped provider.
// This path never calls CreateAuthorizedRefund or infers a committed refund.
func (p *merchantGuardedPay) recoverOriginalRefundResponse(ctx context.Context, actor MerchantPrincipal, request RefundRequest, invoice Invoice) (RefundRequest, error) {
	if p.admission == nil || actor.Account != request.ApprovedBy || p.admission.account != actor.Account || p.admission.merchantID != request.MerchantID {
		return request, nil
	}
	requestHash, invoiceHash := hashJSON(request), hashJSON(invoice)
	err := p.service.store.Update(func(data *Snapshot) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if hashJSON(data.Refunds[request.ID]) != requestHash || hashJSON(data.Invoices[invoice.ID]) != invoiceHash {
			return errors.New("original refund request or invoice changed during recovery")
		}
		slot := hashString("YNX_PAY_ORIGINAL_REFUND_DISPATCH_V1", request.ID)
		dispatch, exists := data.BusinessDispatches[slot]
		if !exists || dispatch.Phase != "unknown" || dispatch.Operation != "refund.submit" || dispatch.Account != actor.Account || dispatch.MerchantID != request.MerchantID || dispatch.ResultCipher == "" {
			return nil
		}
		raw, err := p.base.open(dispatch.ResultCipher)
		var original AuthorizedRefundSubmission
		if err != nil || strictJSON([]byte(raw), &original) != nil || hashJSON(original) != dispatch.RequestHash || original.IdempotencyKey != dispatch.IdempotencyKey || original.RequestID != request.ID || original.InvoiceID != invoice.CentralID || original.IntentID != invoice.IntentID || original.MerchantID != actor.Merchant.CentralMerchantID || original.MerchantAccount != actor.Account || original.Payer != request.Payer || original.Amount != request.Amount || original.Asset != invoice.Asset || original.Reason != request.Reason || original.TransactionHash != request.RefundTransactionHash || original.AuthorizationDigest != request.AuthorizationDigest {
			return errors.New("original refund dispatch requires recovery")
		}
		id := hashString("YNX_MERCHANT_PROVIDER_DISPATCH_V2", request.MerchantID, "refund.authorized", original.IdempotencyKey)
		provider, exists := data.BusinessDispatches[id]
		if !exists || provider.Phase != "response_received" || provider.ResultCipher == "" {
			return nil
		}
		encoded, err := json.Marshal(original)
		if err != nil {
			return err
		}
		digest := sha256.Sum256(encoded)
		if provider.RequestHash != hex.EncodeToString(digest[:]) || provider.Account != actor.Account || provider.SessionBinding != p.admission.binding || provider.MerchantID != request.MerchantID || provider.Operation != "refund.authorized" || provider.IdempotencyKey != original.IdempotencyKey {
			return errors.New("original refund provider binding changed")
		}
		sealed, err := p.base.open(provider.ResultCipher)
		var result chain.RefundRecord
		if err != nil || strictJSON([]byte(sealed), &result) != nil || !identifierRE.MatchString(result.ID) || result.IntentID != original.IntentID || result.Amount != original.Amount || result.Currency != original.Asset || (result.Status != "submitted" && result.Status != "pending") || result.IdempotencyKey != original.IdempotencyKey {
			return errors.New("original refund provider response requires recovery")
		}
		request.Status, request.CentralRefundID, request.UpdatedAt = "submitted", result.ID, p.base.now().UTC()
		dispatch.Phase, dispatch.UpdatedAt = "submitted", request.UpdatedAt
		data.BusinessDispatches[slot], data.Refunds[request.ID] = dispatch, request
		appendAudit(data, request.MerchantID, actor.Account, "refund.submit", request.ID, "submitted", request.AuthorizationDigest, request.UpdatedAt)
		return nil
	})
	return request, err
}
func (p *merchantGuardedPay) RefundEvidence(ctx context.Context, id string) (AuthoritativeRefundEvidence, error) {
	api, ok := p.original.(AuthorizedRefundAPI)
	if !ok {
		return AuthoritativeRefundEvidence{}, errors.New("authoritative refund evidence API is unavailable")
	}
	if err := p.service.store.View(func(Snapshot) error { return ctx.Err() }); err != nil {
		return AuthoritativeRefundEvidence{}, err
	}
	out, err := api.RefundEvidence(ctx, id)
	if err != nil {
		return out, err
	}
	if err = p.service.store.View(func(Snapshot) error { return ctx.Err() }); err != nil {
		return AuthoritativeRefundEvidence{}, err
	}
	return out, nil
}
