package payproduct

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

const (
	quantEvidenceVersion = 1
	quantBillVersion     = 1
	maxPerformanceFeeBPS = int64(5000)
)

type QuantBillingEvidence struct {
	Version                 int       `json:"version"`
	EvidenceID              string    `json:"evidenceId"`
	MerchantID              string    `json:"merchantId"`
	PayerAccount            string    `json:"payerAccount,omitempty"`
	PayerAccountHash        string    `json:"payerAccountHash"`
	InvoicePayerAccountHash string    `json:"invoicePayerAccountHash"`
	ServiceReference        string    `json:"serviceReference"`
	PeriodStart             time.Time `json:"periodStart"`
	PeriodEnd               time.Time `json:"periodEnd"`
	StartEquityYNXT         int64     `json:"startEquityYnxt"`
	EndEquityYNXT           int64     `json:"endEquityYnxt"`
	NetExternalFlowsYNXT    int64     `json:"netExternalFlowsYnxt"`
	PreviousHighWaterMark   int64     `json:"previousHighWaterMarkYnxt"`
	PerformanceFeeBPS       int64     `json:"performanceFeeBps"`
	ComputeFeeYNXT          int64     `json:"computeFeeYnxt"`
	DataFeeYNXT             int64     `json:"dataFeeYnxt"`
	SubscriptionFeeYNXT     int64     `json:"subscriptionFeeYnxt"`
	ManagementFeeYNXT       int64     `json:"managementFeeYnxt"`
	Asset                   string    `json:"asset"`
	Network                 string    `json:"network"`
	Source                  string    `json:"source"`
	SourceVersion           int       `json:"sourceVersion"`
	AsOf                    time.Time `json:"asOf"`
	ExpiresAt               time.Time `json:"expiresAt"`
	EvidenceKeyID           string    `json:"evidenceKeyId"`
	EvidencePublicKey       string    `json:"evidencePublicKey"`
	SignatureAlgorithm      string    `json:"signatureAlgorithm"`
	Signature               string    `json:"signature"`
}

type QuantBillingBreakdown struct {
	StartEquityYNXT        int64  `json:"startEquityYnxt"`
	EndEquityYNXT          int64  `json:"endEquityYnxt"`
	NetExternalFlowsYNXT   int64  `json:"netExternalFlowsYnxt"`
	AdjustedEndEquityYNXT  int64  `json:"adjustedEndEquityYnxt"`
	PreviousHighWaterMark  int64  `json:"previousHighWaterMarkYnxt"`
	HighWaterMarkBaseYNXT  int64  `json:"highWaterMarkBaseYnxt"`
	EligibleProfitYNXT     int64  `json:"eligibleProfitYnxt"`
	PerformanceFeeBPS      int64  `json:"performanceFeeBps"`
	PerformanceFeeYNXT     int64  `json:"performanceFeeYnxt"`
	NewHighWaterMarkYNXT   int64  `json:"newHighWaterMarkYnxt"`
	ComputeFeeYNXT         int64  `json:"computeFeeYnxt"`
	DataFeeYNXT            int64  `json:"dataFeeYnxt"`
	SubscriptionFeeYNXT    int64  `json:"subscriptionFeeYnxt"`
	ManagementFeeYNXT      int64  `json:"managementFeeYnxt"`
	TotalServiceFeeYNXT    int64  `json:"totalServiceFeeYnxt"`
	CalculationDomain      string `json:"calculationDomain"`
	PerformanceFeeRounding string `json:"performanceFeeRounding"`
	ExternalPnLRequired    bool   `json:"externalPnlRequired"`
	FrontendPnLAccepted    bool   `json:"frontendPnlAccepted"`
	ManagerDeclaredPnL     bool   `json:"managerDeclaredPnlAccepted"`
}

type QuantBill struct {
	Version          int                   `json:"version"`
	ID               string                `json:"id"`
	MerchantID       string                `json:"merchantId"`
	MerchantName     string                `json:"merchantName"`
	PayoutAddress    string                `json:"payoutAddress"`
	PayerAccount     string                `json:"payerAccount,omitempty"`
	PayerAccountHash string                `json:"payerAccountHash"`
	ServiceReference string                `json:"serviceReference"`
	PeriodStart      time.Time             `json:"periodStart"`
	PeriodEnd        time.Time             `json:"periodEnd"`
	Asset            string                `json:"asset"`
	Network          string                `json:"network"`
	Breakdown        QuantBillingBreakdown `json:"breakdown"`
	Evidence         QuantBillingEvidence  `json:"evidence"`
	EvidenceDigest   string                `json:"evidenceDigest"`
	InvoiceID        string                `json:"invoiceId"`
	Status           string                `json:"status"`
	CreatedAt        time.Time             `json:"createdAt"`
	UpdatedAt        time.Time             `json:"updatedAt"`
}

type QuantBillInput struct {
	Evidence         QuantBillingEvidence `json:"evidence"`
	ExpiresInMinutes int64                `json:"expiresInMinutes"`
	IdempotencyKey   string               `json:"idempotencyKey"`
}

func prepareQuantEvidenceConfig(input map[string]ed25519.PublicKey, maximumAge time.Duration) (map[string]ed25519.PublicKey, time.Duration, error) {
	if maximumAge == 0 {
		maximumAge = 24 * time.Hour
	}
	if maximumAge < time.Minute || maximumAge > 7*24*time.Hour {
		return nil, 0, errors.New("Quant evidence maximum age must be between one minute and seven days")
	}
	out := make(map[string]ed25519.PublicKey, len(input))
	for keyID, publicKey := range input {
		keyID = strings.TrimSpace(keyID)
		if !identifierRE.MatchString(keyID) || len(publicKey) != ed25519.PublicKeySize {
			return nil, 0, errors.New("Quant evidence verifier configuration is invalid")
		}
		if _, exists := out[keyID]; exists {
			return nil, 0, errors.New("Quant evidence verifier IDs collide after normalization")
		}
		out[keyID] = append(ed25519.PublicKey(nil), publicKey...)
	}
	return out, maximumAge, nil
}

func (s *Service) CreateQuantBill(ctx context.Context, merchant Merchant, input QuantBillInput) (QuantBill, error) {
	key, err := validKey(input.IdempotencyKey)
	if err != nil {
		return QuantBill{}, err
	}
	if input.ExpiresInMinutes < 1 || input.ExpiresInMinutes > 24*60 {
		return QuantBill{}, errors.New("Quant invoice expiry must be between 1 and 1440 minutes")
	}
	breakdown, digest, evidence, err := s.validateQuantEvidence(merchant, input.Evidence)
	if err != nil {
		return QuantBill{}, err
	}
	requestHash := hashJSON(struct {
		EvidenceDigest   string `json:"evidenceDigest"`
		ExpiresInMinutes int64  `json:"expiresInMinutes"`
	}{EvidenceDigest: digest, ExpiresInMinutes: input.ExpiresInMinutes})
	if existing, ok, err := s.idempotentQuantBill(merchant.ID, key, requestHash); err != nil {
		return QuantBill{}, err
	} else if ok {
		return s.QuantBill(ctx, existing.ID)
	}

	billID := "qbl_" + hashString(merchant.ID, digest)[:20]
	invoiceKey := "quantinv-" + hashString(billID, digest)[:24]
	invoice, err := s.createInvoice(ctx, merchant, InvoiceInput{
		Description:      "Verified service billing · " + evidence.ServiceReference,
		Amount:           breakdown.TotalServiceFeeYNXT,
		ExpiresInMinutes: input.ExpiresInMinutes,
		IdempotencyKey:   invoiceKey,
	}, &InvoiceBinding{
		ServiceBillID:         billID,
		ServiceEvidenceDigest: digest,
		ExpectedPayer:         evidence.PayerAccount,
	})
	if err != nil {
		return QuantBill{}, err
	}

	now := s.now().UTC()
	bill := QuantBill{
		Version:          quantBillVersion,
		ID:               billID,
		MerchantID:       merchant.ID,
		MerchantName:     merchant.DisplayName,
		PayoutAddress:    merchant.PayoutAddress,
		PayerAccount:     evidence.PayerAccount,
		PayerAccountHash: evidence.InvoicePayerAccountHash,
		ServiceReference: evidence.ServiceReference,
		PeriodStart:      evidence.PeriodStart,
		PeriodEnd:        evidence.PeriodEnd,
		Asset:            NativeAsset,
		Network:          ChainID,
		Breakdown:        breakdown,
		Evidence:         evidence,
		EvidenceDigest:   digest,
		InvoiceID:        invoice.ID,
		Status:           invoice.Status,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	err = s.idempotentUpdate("quant-bill", merchant.ID, key, requestHash, bill.ID, func(data *Snapshot) error {
		data.QuantBills[bill.ID] = bill
		appendAudit(data, merchant.ID, merchant.ID, "quant.bill.create", bill.ID, "committed", "invoice "+invoice.ID+" evidence "+digest, now)
		return nil
	})
	if err != nil {
		return QuantBill{}, err
	}
	return bill, nil
}

func (s *Service) QuantBill(ctx context.Context, id string) (QuantBill, error) {
	var bill QuantBill
	if err := s.store.View(func(data Snapshot) error {
		var ok bool
		bill, ok = data.QuantBills[id]
		if !ok {
			return errors.New("Quant bill not found")
		}
		return nil
	}); err != nil {
		return QuantBill{}, err
	}
	invoice, err := s.Invoice(ctx, bill.InvoiceID)
	if err != nil {
		return QuantBill{}, err
	}
	if invoice.Version != 5 || invoice.ServiceBillID != bill.ID || invoice.ServiceEvidenceDigest != bill.EvidenceDigest || invoice.ExpectedPayer != bill.PayerAccount || invoice.ExpectedPayerHash != bill.PayerAccountHash || invoice.Amount != bill.Breakdown.TotalServiceFeeYNXT || invoice.MerchantID != bill.MerchantID {
		return QuantBill{}, errors.New("Quant bill invoice binding is invalid")
	}
	if bill.Status != invoice.Status {
		bill.Status = invoice.Status
		bill.UpdatedAt = s.now().UTC()
		if err := s.store.Update(func(data *Snapshot) error {
			data.QuantBills[bill.ID] = bill
			return nil
		}); err != nil {
			return QuantBill{}, err
		}
	}
	return bill, nil
}

func (s *Service) validateQuantEvidence(merchant Merchant, evidence QuantBillingEvidence) (QuantBillingBreakdown, string, QuantBillingEvidence, error) {
	if len(s.quantEvidenceKeys) == 0 {
		return QuantBillingBreakdown{}, "", QuantBillingEvidence{}, errors.New("Quant evidence verification is unavailable")
	}
	evidence.EvidenceID = strings.TrimSpace(evidence.EvidenceID)
	evidence.MerchantID = strings.TrimSpace(evidence.MerchantID)
	evidence.PayerAccount = strings.TrimSpace(evidence.PayerAccount)
	evidence.PayerAccountHash = strings.ToLower(strings.TrimSpace(evidence.PayerAccountHash))
	evidence.InvoicePayerAccountHash = strings.ToLower(strings.TrimSpace(evidence.InvoicePayerAccountHash))
	evidence.ServiceReference = strings.TrimSpace(evidence.ServiceReference)
	evidence.Asset = strings.TrimSpace(evidence.Asset)
	evidence.Network = strings.TrimSpace(evidence.Network)
	evidence.Source = strings.TrimSpace(evidence.Source)
	evidence.EvidenceKeyID = strings.TrimSpace(evidence.EvidenceKeyID)
	evidence.EvidencePublicKey = strings.ToLower(strings.TrimSpace(evidence.EvidencePublicKey))
	evidence.SignatureAlgorithm = strings.ToLower(strings.TrimSpace(evidence.SignatureAlgorithm))
	evidence.Signature = strings.ToLower(strings.TrimSpace(evidence.Signature))

	if evidence.Version != quantEvidenceVersion || evidence.MerchantID != merchant.ID || !identifierRE.MatchString(evidence.EvidenceID) || !identifierRE.MatchString(evidence.ServiceReference) || !identifierRE.MatchString(evidence.Source) || evidence.SourceVersion < 1 || evidence.Asset != NativeAsset || evidence.Network != ChainID || evidence.SignatureAlgorithm != "ed25519" {
		return QuantBillingBreakdown{}, "", QuantBillingEvidence{}, errors.New("Quant evidence identity or authority is invalid")
	}
	payerHex, err := accountaddress.Decode(evidence.PayerAccount)
	if err != nil {
		return QuantBillingBreakdown{}, "", QuantBillingEvidence{}, errors.New("Quant evidence payer account is invalid")
	}
	canonicalPayer, _ := accountaddress.Encode(payerHex)
	if canonicalPayer != evidence.PayerAccount {
		return QuantBillingBreakdown{}, "", QuantBillingEvidence{}, errors.New("Quant evidence payer account is not canonical")
	}
	expectedPayerHash := hashString("YNX_QUANT_PAYER_V1", evidence.PayerAccount)
	expectedInvoicePayerHash := hashString("YNX_PAY_EXPECTED_PAYER_V1", evidence.PayerAccount)
	if evidence.PayerAccountHash != expectedPayerHash || evidence.InvoicePayerAccountHash != expectedInvoicePayerHash {
		return QuantBillingBreakdown{}, "", QuantBillingEvidence{}, errors.New("Quant evidence payer hashes do not match")
	}
	publicKey, ok := s.quantEvidenceKeys[evidence.EvidenceKeyID]
	if !ok || evidence.EvidencePublicKey != hex.EncodeToString(publicKey) {
		return QuantBillingBreakdown{}, "", QuantBillingEvidence{}, errors.New("Quant evidence signing key is not approved")
	}
	signature, err := hex.DecodeString(evidence.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(publicKey, quantEvidenceSigningMaterial(evidence), signature) {
		return QuantBillingBreakdown{}, "", QuantBillingEvidence{}, errors.New("Quant evidence signature verification failed")
	}
	now := s.now().UTC()
	if evidence.PeriodStart.IsZero() || !evidence.PeriodStart.Before(evidence.PeriodEnd) || evidence.PeriodEnd.After(evidence.AsOf) || evidence.AsOf.After(now.Add(30*time.Second)) || now.Sub(evidence.AsOf) > s.quantEvidenceMaxAge || !now.Before(evidence.ExpiresAt) || evidence.ExpiresAt.After(evidence.AsOf.Add(24*time.Hour)) {
		return QuantBillingBreakdown{}, "", QuantBillingEvidence{}, errors.New("Quant evidence time bounds are invalid or stale")
	}
	if evidence.StartEquityYNXT <= 0 || evidence.EndEquityYNXT < 0 || evidence.PreviousHighWaterMark < 0 || evidence.PerformanceFeeBPS < 0 || evidence.PerformanceFeeBPS > maxPerformanceFeeBPS || evidence.ComputeFeeYNXT < 0 || evidence.DataFeeYNXT < 0 || evidence.SubscriptionFeeYNXT < 0 || evidence.ManagementFeeYNXT < 0 {
		return QuantBillingBreakdown{}, "", QuantBillingEvidence{}, errors.New("Quant evidence amounts or fee policy are invalid")
	}

	adjustedEnd, ok := safeSubInt64(evidence.EndEquityYNXT, evidence.NetExternalFlowsYNXT)
	if !ok || adjustedEnd < 0 {
		return QuantBillingBreakdown{}, "", QuantBillingEvidence{}, errors.New("Quant evidence net-flow adjustment is invalid")
	}
	hwmBase := maxInt64(evidence.PreviousHighWaterMark, evidence.StartEquityYNXT)
	eligibleProfit := int64(0)
	if adjustedEnd > hwmBase {
		eligibleProfit = adjustedEnd - hwmBase
	}
	performanceFee, ok := safeBPS(eligibleProfit, evidence.PerformanceFeeBPS)
	if !ok {
		return QuantBillingBreakdown{}, "", QuantBillingEvidence{}, errors.New("Quant performance fee exceeds supported range")
	}
	total, ok := sumNonnegativeInt64(evidence.ComputeFeeYNXT, evidence.DataFeeYNXT, evidence.SubscriptionFeeYNXT, evidence.ManagementFeeYNXT, performanceFee)
	if !ok || total <= 0 {
		return QuantBillingBreakdown{}, "", QuantBillingEvidence{}, errors.New("Quant service fee total is invalid")
	}
	postFeeEnd, ok := safeSubInt64(adjustedEnd, performanceFee)
	if !ok || postFeeEnd < 0 {
		return QuantBillingBreakdown{}, "", QuantBillingEvidence{}, errors.New("Quant post-fee high-water mark is invalid")
	}
	newHWM := maxInt64(evidence.PreviousHighWaterMark, postFeeEnd)
	breakdown := QuantBillingBreakdown{
		StartEquityYNXT:        evidence.StartEquityYNXT,
		EndEquityYNXT:          evidence.EndEquityYNXT,
		NetExternalFlowsYNXT:   evidence.NetExternalFlowsYNXT,
		AdjustedEndEquityYNXT:  adjustedEnd,
		PreviousHighWaterMark:  evidence.PreviousHighWaterMark,
		HighWaterMarkBaseYNXT:  hwmBase,
		EligibleProfitYNXT:     eligibleProfit,
		PerformanceFeeBPS:      evidence.PerformanceFeeBPS,
		PerformanceFeeYNXT:     performanceFee,
		NewHighWaterMarkYNXT:   newHWM,
		ComputeFeeYNXT:         evidence.ComputeFeeYNXT,
		DataFeeYNXT:            evidence.DataFeeYNXT,
		SubscriptionFeeYNXT:    evidence.SubscriptionFeeYNXT,
		ManagementFeeYNXT:      evidence.ManagementFeeYNXT,
		TotalServiceFeeYNXT:    total,
		CalculationDomain:      "YNX_QUANT_HIGH_WATER_MARK_V1",
		PerformanceFeeRounding: "floor-to-whole-YNXT-unit",
		ExternalPnLRequired:    true,
		FrontendPnLAccepted:    false,
		ManagerDeclaredPnL:     false,
	}
	digest := hexSHA(quantEvidenceSigningMaterial(evidence))
	return breakdown, digest, evidence, nil
}

func quantEvidenceSigningMaterial(e QuantBillingEvidence) []byte {
	parts := []string{
		"YNX_QUANT_BILLING_EVIDENCE_V1",
		fmt.Sprint(e.Version),
		e.EvidenceID,
		e.MerchantID,
		e.PayerAccountHash,
		e.InvoicePayerAccountHash,
		e.ServiceReference,
		e.PeriodStart.UTC().Format(time.RFC3339Nano),
		e.PeriodEnd.UTC().Format(time.RFC3339Nano),
		fmt.Sprint(e.StartEquityYNXT),
		fmt.Sprint(e.EndEquityYNXT),
		fmt.Sprint(e.NetExternalFlowsYNXT),
		fmt.Sprint(e.PreviousHighWaterMark),
		fmt.Sprint(e.PerformanceFeeBPS),
		fmt.Sprint(e.ComputeFeeYNXT),
		fmt.Sprint(e.DataFeeYNXT),
		fmt.Sprint(e.SubscriptionFeeYNXT),
		fmt.Sprint(e.ManagementFeeYNXT),
		e.Asset,
		e.Network,
		e.Source,
		fmt.Sprint(e.SourceVersion),
		e.AsOf.UTC().Format(time.RFC3339Nano),
		e.ExpiresAt.UTC().Format(time.RFC3339Nano),
		e.EvidenceKeyID,
		e.EvidencePublicKey,
		e.SignatureAlgorithm,
	}
	return []byte(strings.Join(parts, "|"))
}

func publicQuantBill(bill QuantBill) QuantBill {
	bill.PayerAccount = ""
	bill.Evidence.PayerAccount = ""
	return bill
}

func (s *Service) idempotentQuantBill(merchantID, key, requestHash string) (QuantBill, bool, error) {
	var bill QuantBill
	var ok bool
	err := s.store.View(func(data Snapshot) error {
		record, found := data.Idempotency["quant-bill:"+merchantID+":"+key]
		if !found {
			return nil
		}
		if record.RequestHash != requestHash {
			return errors.New("idempotency key reused with different Quant evidence")
		}
		bill, ok = data.QuantBills[record.ObjectID]
		return nil
	})
	return bill, ok, err
}

func safeSubInt64(left, right int64) (int64, bool) {
	value := new(big.Int).Sub(big.NewInt(left), big.NewInt(right))
	if !value.IsInt64() {
		return 0, false
	}
	return value.Int64(), true
}

func safeBPS(amount, bps int64) (int64, bool) {
	value := new(big.Int).Mul(big.NewInt(amount), big.NewInt(bps))
	value.Quo(value, big.NewInt(10_000))
	if !value.IsInt64() {
		return 0, false
	}
	return value.Int64(), true
}

func sumNonnegativeInt64(values ...int64) (int64, bool) {
	total := big.NewInt(0)
	for _, value := range values {
		if value < 0 {
			return 0, false
		}
		total.Add(total, big.NewInt(value))
	}
	if !total.IsInt64() {
		return 0, false
	}
	return total.Int64(), true
}

func maxInt64(left, right int64) int64 {
	if left > right {
		return left
	}
	return right
}

func quantVerifierIDs(keys map[string]ed25519.PublicKey) []string {
	ids := make([]string, 0, len(keys))
	for id := range keys {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
