package payproduct

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

const recurringDraftDomain = "YNX_PAY_RECURRING_DRAFT_V1"

type RecurringDraftInput struct {
	Payer              string    `json:"payer"`
	Description        string    `json:"description"`
	Amount             int64     `json:"amount"`
	CadenceDays        int       `json:"cadenceDays"`
	MaximumOccurrences int       `json:"maximumOccurrences"`
	StartsAt           time.Time `json:"startsAt"`
	IdempotencyKey     string    `json:"idempotencyKey"`
}

type RecurringDraft struct {
	Version                       int       `json:"version"`
	ID                            string    `json:"id"`
	MerchantID                    string    `json:"merchantId"`
	MerchantName                  string    `json:"merchantName"`
	PayoutAddress                 string    `json:"payoutAddress"`
	Payer                         string    `json:"payer"`
	Description                   string    `json:"description"`
	Amount                        int64     `json:"amount"`
	Asset                         string    `json:"asset"`
	Network                       string    `json:"network"`
	CadenceDays                   int       `json:"cadenceDays"`
	MaximumOccurrences            int       `json:"maximumOccurrences"`
	StartsAt                      time.Time `json:"startsAt"`
	Status                        string    `json:"status"`
	AutomaticChargeEnabled        bool      `json:"automaticChargeEnabled"`
	WalletApprovalEveryOccurrence bool      `json:"walletApprovalEveryOccurrence"`
	Signature                     string    `json:"signature"`
	SigningPublicKey              string    `json:"signingPublicKey"`
	SignatureAlgorithm            string    `json:"signatureAlgorithm"`
	CreatedAt                     time.Time `json:"createdAt"`
	UpdatedAt                     time.Time `json:"updatedAt"`
}

func (s *Service) CreateRecurringDraft(merchant Merchant, input RecurringDraftInput) (RecurringDraft, error) {
	payer, err := nativewallet.NormalizeNativeAddress(input.Payer)
	if err != nil {
		return RecurringDraft{}, errors.New("recurring draft payer must be a native YNX account")
	}
	description := strings.TrimSpace(input.Description)
	if len(description) < 2 || len(description) > 240 || input.Amount <= 0 {
		return RecurringDraft{}, errors.New("recurring description and positive amount are required")
	}
	if input.CadenceDays < 1 || input.CadenceDays > 365 || input.MaximumOccurrences < 2 || input.MaximumOccurrences > 120 {
		return RecurringDraft{}, errors.New("recurring cadence or occurrence limit is outside the supported range")
	}
	now := s.now().UTC()
	starts := input.StartsAt.UTC()
	if starts.Before(now) || starts.After(now.Add(365*24*time.Hour)) {
		return RecurringDraft{}, errors.New("recurring start must be within the next 365 days")
	}
	key, err := validKey(input.IdempotencyKey)
	if err != nil {
		return RecurringDraft{}, err
	}
	requestHash := hashJSON(input)
	var existing RecurringDraft
	var found bool
	if err := s.store.View(func(data Snapshot) error {
		if record, ok := data.Idempotency["recurring-draft:"+merchant.ID+":"+key]; ok {
			if record.RequestHash != requestHash {
				return errors.New("idempotency key reused with different recurring draft")
			}
			existing, found = data.RecurringDrafts[record.ObjectID]
		}
		return nil
	}); err != nil || found {
		return existing, err
	}
	draft := RecurringDraft{Version: 1, ID: "rcd_" + hashString(merchant.ID, payer, key)[:20], MerchantID: merchant.ID, MerchantName: merchant.DisplayName, PayoutAddress: merchant.PayoutAddress, Payer: payer, Description: description, Amount: input.Amount, Asset: NativeAsset, Network: ChainID, CadenceDays: input.CadenceDays, MaximumOccurrences: input.MaximumOccurrences, StartsAt: starts, Status: "draft", AutomaticChargeEnabled: false, WalletApprovalEveryOccurrence: true, SigningPublicKey: merchant.InvoiceSigningPublicKey, SignatureAlgorithm: "ed25519", CreatedAt: now, UpdatedAt: now}
	privateText, err := s.open(merchant.InvoiceSigningPrivateCipher)
	if err != nil {
		return RecurringDraft{}, errors.New("merchant recurring signing key unavailable")
	}
	privateKey, err := base64.RawStdEncoding.DecodeString(privateText)
	if err != nil || len(privateKey) != ed25519.PrivateKeySize {
		return RecurringDraft{}, errors.New("merchant recurring signing key invalid")
	}
	draft.Signature = hex.EncodeToString(ed25519.Sign(ed25519.PrivateKey(privateKey), recurringDraftMaterial(draft)))
	err = s.idempotentUpdate("recurring-draft", merchant.ID, key, requestHash, draft.ID, func(data *Snapshot) error {
		data.RecurringDrafts[draft.ID] = draft
		appendAudit(data, merchant.ID, merchant.ID, "recurring-draft.create", draft.ID, "draft", "automatic charge disabled; Wallet approval required for every occurrence", now)
		return nil
	})
	return draft, err
}

func recurringDraftMaterial(v RecurringDraft) []byte {
	return []byte(strings.Join([]string{recurringDraftDomain, fmt.Sprint(v.Version), v.ID, v.MerchantID, v.MerchantName, v.PayoutAddress, v.Payer, v.Description, fmt.Sprint(v.Amount), v.Asset, v.Network, fmt.Sprint(v.CadenceDays), fmt.Sprint(v.MaximumOccurrences), v.StartsAt.UTC().Format(time.RFC3339Nano), v.Status, fmt.Sprint(v.AutomaticChargeEnabled), fmt.Sprint(v.WalletApprovalEveryOccurrence), v.SigningPublicKey, v.SignatureAlgorithm, v.CreatedAt.UTC().Format(time.RFC3339Nano)}, "|"))
}
