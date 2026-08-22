package payproduct

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const refundAuthorizationDomain = "YNX_PAY_REFUND_AUTHORIZATION_V1"

type RefundAuthorization struct {
	Version          string `json:"version"`
	RequestID        string `json:"requestId"`
	InvoiceID        string `json:"invoiceId"`
	ChainID          string `json:"chainId"`
	MerchantID       string `json:"merchantId"`
	Account          string `json:"account"`
	AccountPublicKey string `json:"accountPublicKey"`
	Payer            string `json:"payer"`
	Amount           int64  `json:"amount"`
	Asset            string `json:"asset"`
	TransactionHash  string `json:"transactionHash"`
	IssuedAt         string `json:"issuedAt"`
	WalletSignature  string `json:"walletSignature"`
}

type AuthorizedRefundSubmission struct {
	RequestID           string `json:"requestId"`
	InvoiceID           string `json:"invoiceId"`
	IntentID            string `json:"intentId"`
	MerchantID          string `json:"merchantId"`
	MerchantAccount     string `json:"merchantAccount"`
	Payer               string `json:"payer"`
	Amount              int64  `json:"amount"`
	Asset               string `json:"asset"`
	Reason              string `json:"reason"`
	TransactionHash     string `json:"transactionHash"`
	AuthorizationDigest string `json:"authorizationDigest"`
	IdempotencyKey      string `json:"idempotencyKey"`
}

type AuthoritativeRefundEvidence struct {
	ID              string    `json:"id"`
	RequestID       string    `json:"requestId"`
	InvoiceID       string    `json:"invoiceId"`
	IntentID        string    `json:"intentId"`
	ChainID         string    `json:"chainId"`
	MerchantID      string    `json:"merchantId"`
	MerchantAccount string    `json:"merchantAccount"`
	Payer           string    `json:"payer"`
	Amount          int64     `json:"amount"`
	Asset           string    `json:"asset"`
	TransactionHash string    `json:"transactionHash"`
	BlockNumber     uint64    `json:"blockNumber"`
	Finality        string    `json:"finality"`
	Status          string    `json:"status"`
	ReceiptID       string    `json:"receiptId"`
	AuditHash       string    `json:"auditHash"`
	CommittedAt     time.Time `json:"committedAt"`
	Source          string    `json:"source"`
	SourceAsOf      time.Time `json:"sourceAsOf"`
	SourceVersion   int       `json:"sourceVersion"`
	Confidence      string    `json:"confidence"`
}

type AuthorizedRefundAPI interface {
	CreateAuthorizedRefund(context.Context, AuthorizedRefundSubmission) (chain.RefundRecord, error)
	RefundEvidence(context.Context, string) (AuthoritativeRefundEvidence, error)
}

func (s *Service) SubmitRefundAuthorization(ctx context.Context, actor MerchantPrincipal, requestID string, authorization RefundAuthorization, key string) (RefundRequest, error) {
	if actor.Role != "owner" && actor.Role != "finance" {
		return RefundRequest{}, errors.New("owner or finance role required for refund submission")
	}
	api, ok := s.pay.(AuthorizedRefundAPI)
	if !ok {
		return RefundRequest{}, errors.New("authoritative refund transaction API is unavailable")
	}
	key, err := validKey(key)
	if err != nil {
		return RefundRequest{}, err
	}
	s.mutation.Lock()
	defer s.mutation.Unlock()
	var request RefundRequest
	var invoice Invoice
	err = s.store.View(func(data Snapshot) error {
		var found bool
		request, found = data.Refunds[requestID]
		if !found || request.MerchantID != actor.Merchant.ID {
			return errors.New("refund request not found")
		}
		invoice = data.Invoices[request.InvoiceID]
		if request.Status == "refunded" {
			return nil
		}
		if request.Status != "requested" && request.Status != "submitted" {
			return errors.New("refund request is not awaiting merchant authorization")
		}
		return nil
	})
	if err != nil || request.Status == "refunded" {
		return request, err
	}
	issued, err := strictMilliseconds(authorization.IssuedAt)
	if err != nil || issued.After(s.now().Add(30*time.Second)) || s.now().Sub(issued) > 5*time.Minute {
		return RefundRequest{}, errors.New("refund authorization time is invalid or expired")
	}
	if authorization.Version != "1" || !walletNoncePattern.MatchString(authorization.RequestID) || authorization.InvoiceID != invoice.ID || authorization.ChainID != ChainID || authorization.MerchantID != actor.Merchant.ID || authorization.Account != actor.Account || authorization.Payer != request.Payer || authorization.Amount != request.Amount || authorization.Asset != invoice.Asset || !walletTxPattern.MatchString(strings.ToLower(authorization.TransactionHash)) || !walletSignaturePattern.MatchString(strings.ToLower(authorization.WalletSignature)) {
		return RefundRequest{}, errors.New("refund authorization does not match the request, merchant, or Wallet session")
	}
	unsigned := map[string]any{"version": authorization.Version, "requestId": authorization.RequestID, "invoiceId": authorization.InvoiceID, "chainId": authorization.ChainID, "merchantId": authorization.MerchantID, "account": authorization.Account, "accountPublicKey": authorization.AccountPublicKey, "payer": authorization.Payer, "amount": authorization.Amount, "asset": authorization.Asset, "transactionHash": strings.ToLower(authorization.TransactionHash), "issuedAt": authorization.IssuedAt}
	if err := verifyCompactWalletSignature(authorization.Account, authorization.AccountPublicKey, strings.ToLower(authorization.WalletSignature), refundAuthorizationDomain+"\n"+string(mustCanonical(unsigned))); err != nil {
		return RefundRequest{}, err
	}
	digest := digestCanonical(refundAuthorizationDomain, unsigned)
	if request.Status == "submitted" {
		if request.AuthorizationDigest == digest && request.RefundTransactionHash == strings.ToLower(authorization.TransactionHash) && request.ApprovedBy == actor.Account {
			return request, nil
		}
		return RefundRequest{}, errors.New("submitted refund authorization does not match the idempotent replay")
	}
	submission := AuthorizedRefundSubmission{RequestID: request.ID, InvoiceID: invoice.CentralID, IntentID: invoice.IntentID, MerchantID: actor.Merchant.CentralMerchantID, MerchantAccount: actor.Account, Payer: request.Payer, Amount: request.Amount, Asset: invoice.Asset, Reason: request.Reason, TransactionHash: strings.ToLower(authorization.TransactionHash), AuthorizationDigest: digest, IdempotencyKey: key}
	central, err := api.CreateAuthorizedRefund(ctx, submission)
	if err != nil {
		return RefundRequest{}, err
	}
	if !identifierRE.MatchString(central.ID) || central.IntentID != invoice.IntentID || central.Amount != request.Amount || central.Currency != invoice.Asset || (central.Status != "submitted" && central.Status != "pending") || central.IdempotencyKey != key {
		return RefundRequest{}, errors.New("central Pay refund submission was incomplete or mismatched")
	}
	now := s.now().UTC()
	request.Status, request.ApprovedBy, request.AuthorizationDigest, request.RefundTransactionHash, request.CentralRefundID, request.SubmittedAt, request.UpdatedAt = "submitted", actor.Account, digest, strings.ToLower(authorization.TransactionHash), central.ID, &now, now
	err = s.store.Update(func(data *Snapshot) error {
		current := data.Refunds[request.ID]
		if current.Status != "requested" {
			return errors.New("refund request state changed")
		}
		for id, candidate := range data.Refunds {
			if id != request.ID && candidate.AuthorizationDigest == digest {
				return errors.New("refund Wallet authorization replay rejected")
			}
			if id != request.ID && candidate.RefundTransactionHash == request.RefundTransactionHash && candidate.RefundTransactionHash != "" {
				return errors.New("refund transaction replay rejected")
			}
		}
		data.Refunds[request.ID] = request
		appendAudit(data, request.MerchantID, actor.Account, "refund.submit", request.ID, "submitted", digest, now)
		return nil
	})
	return request, err
}

func (s *Service) RefreshRefund(ctx context.Context, actor MerchantPrincipal, requestID string) (RefundRequest, error) {
	if actor.Role != "owner" && actor.Role != "finance" && actor.Role != "support" {
		return RefundRequest{}, errors.New("merchant case role required")
	}
	api, ok := s.pay.(AuthorizedRefundAPI)
	if !ok {
		return RefundRequest{}, errors.New("authoritative refund evidence API is unavailable")
	}
	var request RefundRequest
	var invoice Invoice
	if err := s.store.View(func(data Snapshot) error {
		var found bool
		request, found = data.Refunds[requestID]
		if !found || request.MerchantID != actor.Merchant.ID {
			return errors.New("refund request not found")
		}
		invoice = data.Invoices[request.InvoiceID]
		return nil
	}); err != nil {
		return RefundRequest{}, err
	}
	if request.Status == "refunded" && request.Evidence != nil {
		return request, nil
	}
	if request.Status != "submitted" || request.CentralRefundID == "" {
		return RefundRequest{}, errors.New("refund has not been submitted with merchant Wallet authorization")
	}
	evidence, err := api.RefundEvidence(ctx, request.CentralRefundID)
	if err != nil {
		return RefundRequest{}, err
	}
	if evidence.ID != request.CentralRefundID || evidence.RequestID != request.ID || evidence.InvoiceID != invoice.CentralID || evidence.IntentID != invoice.IntentID || evidence.ChainID != ChainID || evidence.MerchantID != actor.Merchant.CentralMerchantID || evidence.MerchantAccount != request.ApprovedBy || evidence.Payer != request.Payer || evidence.Amount != request.Amount || evidence.Asset != invoice.Asset || strings.ToLower(evidence.TransactionHash) != request.RefundTransactionHash || evidence.BlockNumber == 0 || evidence.Finality != "committed" || evidence.Status != "refunded" || evidence.ReceiptID == "" || len(evidence.AuditHash) != 64 || evidence.CommittedAt.IsZero() || evidence.Source != "authoritative-central-pay-api" || evidence.SourceAsOf.IsZero() || evidence.SourceVersion <= 0 || evidence.Confidence != "authoritative" {
		return RefundRequest{}, errors.New("authoritative refund evidence is incomplete or mismatched")
	}
	now := s.now().UTC()
	request.Status, request.Evidence, request.UpdatedAt = "refunded", &evidence, now
	err = s.store.Update(func(data *Snapshot) error {
		current := data.Refunds[request.ID]
		if current.Status != "submitted" {
			return errors.New("refund request state changed")
		}
		data.Refunds[request.ID] = request
		appendAudit(data, request.MerchantID, actor.Account, "refund.committed", request.ID, "refunded", evidence.ReceiptID, now)
		return nil
	})
	if err == nil {
		_ = s.queueWebhook(actor.Merchant, "refund.committed", request.ID)
	}
	return request, err
}
