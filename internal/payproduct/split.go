package payproduct

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

const splitPaymentVersion = 1

type SplitShareInput struct {
	Label  string `json:"label"`
	Amount int64  `json:"amount"`
}

type SplitPaymentInput struct {
	Description      string            `json:"description"`
	Shares           []SplitShareInput `json:"shares"`
	ExpiresInMinutes int64             `json:"expiresInMinutes"`
	IdempotencyKey   string            `json:"idempotencyKey"`
}

type InvoiceBinding struct {
	SplitPaymentID        string
	SplitShareID          string
	ServiceBillID         string
	ServiceEvidenceDigest string
	ExpectedPayer         string
}

type SplitInvoiceBinding = InvoiceBinding

func (s *Service) CreateSplitPayment(merchant Merchant, input SplitPaymentInput) (SplitPayment, error) {
	s.mutation.Lock()
	defer s.mutation.Unlock()

	key, err := validKey(input.IdempotencyKey)
	if err != nil {
		return SplitPayment{}, err
	}
	if input.ExpiresInMinutes < 1 || input.ExpiresInMinutes > 24*60 {
		return SplitPayment{}, errors.New("split payment expiry must be between 1 and 1440 minutes")
	}
	if len(input.Shares) < 2 || len(input.Shares) > 20 {
		return SplitPayment{}, errors.New("split payment requires between 2 and 20 shares")
	}
	description := strings.TrimSpace(input.Description)
	if description == "" || len(description) > 256 {
		return SplitPayment{}, errors.New("split payment description must contain 1 to 256 characters")
	}

	requestHash := hashJSON(input)
	if existing, ok, err := s.idempotentSplit(merchant.ID, key, requestHash); err != nil {
		return SplitPayment{}, err
	} else if ok {
		return existing, nil
	}

	id := "spl_" + hashString(merchant.ID, key)[:20]
	shares := make([]SplitShare, 0, len(input.Shares))
	labels := make(map[string]struct{}, len(input.Shares))
	var total int64
	for index, raw := range input.Shares {
		label := strings.TrimSpace(raw.Label)
		if label == "" || len(label) > 80 {
			return SplitPayment{}, errors.New("split share label must contain 1 to 80 characters")
		}
		labelKey := strings.ToLower(label)
		if _, exists := labels[labelKey]; exists {
			return SplitPayment{}, errors.New("split share labels must be unique")
		}
		labels[labelKey] = struct{}{}
		if raw.Amount <= 0 {
			return SplitPayment{}, errors.New("split share amount must be positive")
		}
		if total > int64(^uint64(0)>>1)-raw.Amount {
			return SplitPayment{}, errors.New("split payment total exceeds supported range")
		}
		total += raw.Amount
		shareID := "shr_" + hashString(id, fmt.Sprint(index), label, fmt.Sprint(raw.Amount))[:16]
		shares = append(shares, SplitShare{ID: shareID, Label: label, Amount: raw.Amount, Status: "open"})
	}

	now := s.now().UTC()
	split := SplitPayment{
		Version:            splitPaymentVersion,
		ID:                 id,
		MerchantID:         merchant.ID,
		MerchantName:       merchant.DisplayName,
		PayoutAddress:      merchant.PayoutAddress,
		Description:        description,
		TotalAmount:        total,
		Asset:              NativeAsset,
		Network:            ChainID,
		Status:             "open",
		Shares:             shares,
		ExpiresAt:          now.Add(time.Duration(input.ExpiresInMinutes) * time.Minute),
		CreatedAt:          now,
		UpdatedAt:          now,
		SignatureKeyID:     merchant.ID + "-invoice-v1",
		SigningPublicKey:   merchant.InvoiceSigningPublicKey,
		SignatureAlgorithm: "ed25519",
	}
	privateText, err := s.open(merchant.InvoiceSigningPrivateCipher)
	if err != nil {
		return SplitPayment{}, errors.New("merchant invoice signing key unavailable")
	}
	privateKey, err := base64.RawStdEncoding.DecodeString(privateText)
	if err != nil || len(privateKey) != ed25519.PrivateKeySize {
		return SplitPayment{}, errors.New("merchant invoice signing key invalid")
	}
	split.Signature = hex.EncodeToString(ed25519.Sign(ed25519.PrivateKey(privateKey), splitSigningMaterial(split)))
	err = s.idempotentUpdate("split", merchant.ID, key, requestHash, split.ID, func(data *Snapshot) error {
		data.SplitPayments[split.ID] = split
		appendAudit(data, merchant.ID, merchant.ID, "split.create", split.ID, "committed", fmt.Sprintf("%d shares", len(split.Shares)), now)
		return nil
	})
	if err != nil {
		return SplitPayment{}, err
	}
	return split, nil
}

func (s *Service) ClaimSplitShare(ctx context.Context, session WalletSession, splitID, shareID, idempotencyKey string) (SplitPayment, error) {
	key, err := validKey(idempotencyKey)
	if err != nil {
		return SplitPayment{}, err
	}
	if !hasScope(session.Scopes, "pay:settlement:submit") || strings.TrimSpace(session.Account) == "" {
		return SplitPayment{}, errors.New("Wallet session lacks split payment scope")
	}

	var split SplitPayment
	var share SplitShare
	err = s.store.View(func(data Snapshot) error {
		var ok bool
		split, ok = data.SplitPayments[splitID]
		if !ok {
			return errors.New("split payment not found")
		}
		for _, candidate := range split.Shares {
			if candidate.ID == shareID {
				share = candidate
				break
			}
		}
		if share.ID == "" {
			return errors.New("split share not found")
		}
		claimID := "split-claim:" + split.MerchantID + ":" + key
		if record, ok := data.Idempotency[claimID]; ok && record.RequestHash != hashString(splitID, shareID, session.Account) {
			return errors.New("idempotency key reused with different split claim")
		}
		return nil
	})
	if err != nil {
		return SplitPayment{}, err
	}
	if !s.now().Before(split.ExpiresAt) {
		return SplitPayment{}, errors.New("split payment expired")
	}
	if share.InvoiceID != "" {
		if share.PayerAccount != session.Account {
			return SplitPayment{}, errors.New("split share already claimed by another account")
		}
		return s.SplitPayment(ctx, split.ID)
	}

	remaining := split.ExpiresAt.Sub(s.now())
	minutes := int64((remaining + time.Minute - 1) / time.Minute)
	if minutes < 1 {
		return SplitPayment{}, errors.New("split payment expired")
	}
	merchant := Merchant{}
	if err := s.store.View(func(data Snapshot) error {
		var ok bool
		merchant, ok = data.Merchants[split.MerchantID]
		if !ok {
			return errors.New("split merchant not found")
		}
		return nil
	}); err != nil {
		return SplitPayment{}, err
	}
	childKey := "splitshare-" + hashString(split.ID, share.ID)[:24]
	invoice, err := s.createInvoice(ctx, merchant, InvoiceInput{
		Description:      split.Description + " · " + share.Label,
		Amount:           share.Amount,
		ExpiresInMinutes: minutes,
		IdempotencyKey:   childKey,
	}, &SplitInvoiceBinding{SplitPaymentID: split.ID, SplitShareID: share.ID, ExpectedPayer: session.Account})
	if err != nil {
		return SplitPayment{}, err
	}

	s.mutation.Lock()
	err = s.store.Update(func(data *Snapshot) error {
		current, ok := data.SplitPayments[split.ID]
		if !ok {
			return errors.New("split payment disappeared during claim")
		}
		updated := false
		claimedAt := s.now().UTC()
		for index := range current.Shares {
			if current.Shares[index].ID != share.ID {
				continue
			}
			if current.Shares[index].InvoiceID != "" && (current.Shares[index].InvoiceID != invoice.ID || current.Shares[index].PayerAccount != session.Account) {
				return errors.New("split share claim conflict")
			}
			current.Shares[index].InvoiceID = invoice.ID
			current.Shares[index].PayerAccount = session.Account
			current.Shares[index].Status = "pending"
			current.Shares[index].ClaimedAt = &claimedAt
			current.Status = "partially_claimed"
			current.UpdatedAt = claimedAt
			updated = true
			break
		}
		if !updated {
			return errors.New("split share not found")
		}
		claimScope := "split-claim:" + current.MerchantID + ":" + key
		requestHash := hashString(split.ID, share.ID, session.Account)
		if record, ok := data.Idempotency[claimScope]; ok {
			if record.RequestHash != requestHash {
				return errors.New("idempotency key reused with different split claim")
			}
		} else {
			data.Idempotency[claimScope] = IdempotencyRecord{Scope: "split-claim", Key: key, RequestHash: requestHash, ObjectID: invoice.ID, CreatedAt: claimedAt}
		}
		data.SplitPayments[current.ID] = current
		appendAudit(data, current.MerchantID, session.Account, "split.share.claim", share.ID, "committed", invoice.ID, claimedAt)
		return nil
	})
	s.mutation.Unlock()
	if err != nil {
		return SplitPayment{}, err
	}
	return s.SplitPayment(ctx, split.ID)
}

func (s *Service) SplitPayment(ctx context.Context, id string) (SplitPayment, error) {
	s.mutation.Lock()
	defer s.mutation.Unlock()

	var split SplitPayment
	if err := s.store.View(func(data Snapshot) error {
		var ok bool
		split, ok = data.SplitPayments[id]
		if !ok {
			return errors.New("split payment not found")
		}
		return nil
	}); err != nil {
		return SplitPayment{}, err
	}

	committed := 0
	claimed := 0
	for index := range split.Shares {
		share := &split.Shares[index]
		if share.InvoiceID == "" {
			share.Status = "open"
			continue
		}
		claimed++
		invoice, err := s.Invoice(ctx, share.InvoiceID)
		if err != nil {
			return SplitPayment{}, err
		}
		if invoice.SplitPaymentID != split.ID || invoice.SplitShareID != share.ID || invoice.ExpectedPayer != share.PayerAccount || invoice.ExpectedPayerHash != hashString("YNX_PAY_EXPECTED_PAYER_V1", share.PayerAccount) || invoice.Amount != share.Amount || invoice.MerchantID != split.MerchantID {
			return SplitPayment{}, errors.New("split child invoice binding is invalid")
		}
		share.Status = invoice.Status
		if invoice.Status == "committed" {
			committed++
		}
	}

	now := s.now().UTC()
	switch {
	case committed == len(split.Shares):
		split.Status = "committed"
	case !now.Before(split.ExpiresAt):
		split.Status = "expired"
	case committed > 0:
		split.Status = "partially_paid"
	case claimed > 0:
		split.Status = "partially_claimed"
	default:
		split.Status = "open"
	}
	split.UpdatedAt = now
	err := s.store.Update(func(data *Snapshot) error {
		data.SplitPayments[split.ID] = split
		return nil
	})
	return split, err
}

func (s *Service) idempotentSplit(merchantID, key, requestHash string) (SplitPayment, bool, error) {
	var split SplitPayment
	var ok bool
	err := s.store.View(func(data Snapshot) error {
		record, found := data.Idempotency["split:"+merchantID+":"+key]
		if !found {
			return nil
		}
		if record.RequestHash != requestHash {
			return errors.New("idempotency key reused with different request")
		}
		split, ok = data.SplitPayments[record.ObjectID]
		return nil
	})
	return split, ok, err
}

func splitSigningMaterial(split SplitPayment) []byte {
	parts := []string{"YNX_PAY_SPLIT_V1", fmt.Sprint(split.Version), split.ID, split.MerchantID, split.MerchantName, split.PayoutAddress, split.Description, fmt.Sprint(split.TotalAmount), split.Asset, split.Network}
	for _, share := range split.Shares {
		parts = append(parts, share.ID, share.Label, fmt.Sprint(share.Amount))
	}
	parts = append(parts, split.ExpiresAt.UTC().Format(time.RFC3339Nano), split.CreatedAt.UTC().Format(time.RFC3339Nano), split.SignatureKeyID, split.SigningPublicKey, split.SignatureAlgorithm)
	return []byte(strings.Join(parts, "|"))
}

func publicSplitPayment(split SplitPayment) SplitPayment {
	split.Shares = append([]SplitShare(nil), split.Shares...)
	for index := range split.Shares {
		split.Shares[index].PayerAccount = ""
	}
	return split
}

func publicInvoice(invoice Invoice) Invoice {
	invoice.ExpectedPayer = ""
	return invoice
}

func invoiceRequestHash(input InvoiceInput, binding *SplitInvoiceBinding) string {
	if binding == nil {
		return hashJSON(input)
	}
	return hashJSON(struct {
		Input   InvoiceInput        `json:"input"`
		Binding SplitInvoiceBinding `json:"binding"`
	}{Input: input, Binding: *binding})
}

func hasScope(scopes []string, required string) bool {
	for _, scope := range scopes {
		if scope == required {
			return true
		}
	}
	return false
}
