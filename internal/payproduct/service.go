package payproduct

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

var identifierRE = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,127}$`)

type AIProvider interface {
	Complete(context.Context, string, string) (provider, model, result string, units int64, err error)
}
type Config struct {
	StorePath         string
	IntegrityKey      []byte
	GatewayKey        []byte
	BootstrapKey      string
	MonitorKey        string
	PublicBaseURL     string
	CentralMerchantID string
	PayAPI            PayAPI
	AI                AIProvider
	ProviderProbe     ProviderProbe
	HTTPClient        *http.Client
	Now               func() time.Time
}
type Service struct {
	store             *Store
	pay               PayAPI
	ai                AIProvider
	providerProbe     ProviderProbe
	bootstrap         string
	monitorKey        string
	publicBase        string
	centralMerchantID string
	key               []byte
	gatewayKey        []byte
	client            *http.Client
	now               func() time.Time
	mutation          sync.Mutex
	aiMu              sync.Mutex
	aiCancels         map[string]context.CancelFunc
}

func New(cfg Config) (*Service, error) {
	if cfg.PayAPI == nil {
		return nil, errors.New("authoritative central Pay API is required")
	}
	if len(cfg.IntegrityKey) < 32 {
		return nil, errors.New("integrity key must contain at least 32 bytes")
	}
	if len(cfg.GatewayKey) < 32 {
		return nil, errors.New("Gateway assertion key must contain at least 32 bytes")
	}
	if len(cfg.BootstrapKey) < 24 {
		return nil, errors.New("merchant bootstrap key must contain at least 24 characters")
	}
	base := strings.TrimRight(cfg.PublicBaseURL, "/")
	u, err := url.Parse(base)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, errors.New("public base URL must be absolute")
	}
	st, err := OpenStore(cfg.StorePath, cfg.IntegrityKey)
	if err != nil {
		return nil, err
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	service := &Service{store: st, pay: cfg.PayAPI, ai: cfg.AI, providerProbe: cfg.ProviderProbe, bootstrap: cfg.BootstrapKey, monitorKey: strings.TrimSpace(cfg.MonitorKey), publicBase: base, centralMerchantID: strings.TrimSpace(cfg.CentralMerchantID), key: append([]byte(nil), cfg.IntegrityKey...), gatewayKey: append([]byte(nil), cfg.GatewayKey...), client: client, now: now, aiCancels: map[string]context.CancelFunc{}}
	_ = service.store.Update(func(data *Snapshot) error {
		for id, run := range data.AIRuns {
			if run.Status == "running" {
				run.Status = "interrupted"
				run.UpdatedAt = now()
				data.AIRuns[id] = run
			}
		}
		return nil
	})
	return service, nil
}

type OnboardInput struct {
	DisplayName    string `json:"displayName"`
	PayoutAddress  string `json:"payoutAddress"`
	WebhookURL     string `json:"webhookUrl,omitempty"`
	IdempotencyKey string `json:"idempotencyKey"`
	OwnerAccount   string `json:"ownerAccount,omitempty"`
}
type OnboardResult struct {
	Merchant      Merchant `json:"merchant"`
	Credential    string   `json:"credential"`
	WebhookSecret string   `json:"webhookSecret"`
}

func (s *Service) Onboard(input OnboardInput) (OnboardResult, error) {
	s.mutation.Lock()
	defer s.mutation.Unlock()
	name := strings.TrimSpace(input.DisplayName)
	if len(name) < 2 || len(name) > 120 {
		return OnboardResult{}, errors.New("merchant display name must contain 2 to 120 characters")
	}
	payout, err := nativewallet.NormalizeNativeAddress(input.PayoutAddress)
	if err != nil {
		return OnboardResult{}, fmt.Errorf("invalid payout address: %w", err)
	}
	ownerAccount := strings.TrimSpace(input.OwnerAccount)
	if ownerAccount == "" {
		ownerAccount = payout
	}
	ownerAccount, err = nativewallet.NormalizeNativeAddress(ownerAccount)
	if err != nil {
		return OnboardResult{}, fmt.Errorf("invalid owner Wallet account: %w", err)
	}
	endpoint, err := validWebhookURL(input.WebhookURL)
	if err != nil {
		return OnboardResult{}, err
	}
	key, err := validKey(input.IdempotencyKey)
	if err != nil {
		return OnboardResult{}, err
	}
	requestHash := hashJSON(input)
	var existing OnboardResult
	var found bool
	err = s.store.View(func(data Snapshot) error {
		if idem, ok := data.Idempotency["onboard:"+key]; ok {
			if idem.RequestHash != requestHash {
				return errors.New("idempotency key reused with different onboarding request")
			}
			m := data.Merchants[idem.ObjectID]
			existing.Merchant = publicMerchant(m)
			found = true
		}
		return nil
	})
	if err != nil {
		return OnboardResult{}, err
	}
	if found {
		return OnboardResult{}, errors.New("onboarding replay is valid but credentials are one-time; use the existing credential")
	}
	credential := randomToken(32)
	webhookSecret := randomToken(32)
	invoicePublic, invoicePrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return OnboardResult{}, fmt.Errorf("generate invoice signing key: %w", err)
	}
	now := s.now()
	id := "mrc_" + hashString(name, payout, key)[:20]
	centralMerchantID := s.centralMerchantID
	if centralMerchantID == "" {
		centralMerchantID = id
	}
	merchant := Merchant{ID: id, CentralMerchantID: centralMerchantID, DisplayName: name, PayoutAddress: payout, Status: "active", WebhookURL: endpoint, SecretVersion: 1, SecretHash: hashString(credential), CredentialCipher: s.seal(credential), WebhookSecretCipher: s.seal(webhookSecret), InvoiceSigningPublicKey: hex.EncodeToString(invoicePublic), InvoiceSigningPrivateCipher: s.seal(base64.RawStdEncoding.EncodeToString(invoicePrivate)), CreatedAt: now, UpdatedAt: now}
	owner := MerchantMember{ID: "mem_" + hashString(id, ownerAccount)[:20], MerchantID: id, Account: ownerAccount, Role: "owner", Status: "active", CreatedAt: now, UpdatedAt: now}
	err = s.store.Update(func(data *Snapshot) error {
		if _, ok := data.Merchants[id]; ok {
			return errors.New("merchant already exists")
		}
		data.Merchants[id] = merchant
		data.MerchantMembers[id+":"+ownerAccount] = owner
		data.Idempotency["onboard:"+key] = IdempotencyRecord{Scope: "onboard", Key: key, RequestHash: requestHash, ObjectID: id, CreatedAt: now}
		appendAudit(data, id, "bootstrap", "merchant.onboard", id, "committed", "merchant identity created", now)
		return nil
	})
	if err != nil {
		return OnboardResult{}, err
	}
	return OnboardResult{Merchant: publicMerchant(merchant), Credential: credential, WebhookSecret: webhookSecret}, nil
}

func (s *Service) Authenticate(method, path string, body []byte, header string) (Merchant, error) {
	parts := strings.Split(strings.TrimSpace(header), ":")
	if len(parts) < 7 || parts[0] != "YNX" {
		return Merchant{}, errors.New("merchant authorization must use YNX merchant:timestamp:nonce:signature")
	}
	merchantID, tsText, nonce, sig := parts[1], strings.Join(parts[2:len(parts)-2], ":"), parts[len(parts)-2], parts[len(parts)-1]
	if !identifierRE.MatchString(merchantID) || len(nonce) < 16 || len(nonce) > 128 {
		return Merchant{}, errors.New("invalid merchant authorization")
	}
	ts, err := time.Parse(time.RFC3339, tsText)
	if err != nil || absDuration(s.now().Sub(ts)) > 5*time.Minute {
		return Merchant{}, errors.New("merchant authorization timestamp expired")
	}
	var merchant Merchant
	err = s.store.View(func(data Snapshot) error {
		var ok bool
		merchant, ok = data.Merchants[merchantID]
		if !ok || merchant.Status != "active" {
			return errors.New("merchant is not active")
		}
		if _, seen := data.Nonces[merchantID+":"+nonce]; seen {
			return errors.New("merchant request replay rejected")
		}
		return nil
	})
	if err != nil {
		return Merchant{}, err
	}
	secret, err := s.open(merchant.CredentialCipher)
	if err != nil {
		return Merchant{}, errors.New("merchant credential unavailable")
	}
	material := strings.Join([]string{"YNX_PAY_PRODUCT_REQUEST_V1", strings.ToUpper(method), path, hexSHA(body), tsText, nonce}, "\n")
	expected := hmacHex([]byte(secret), []byte(material))
	if !hmac.Equal([]byte(expected), []byte(strings.ToLower(sig))) {
		return Merchant{}, errors.New("invalid merchant request signature")
	}
	err = s.store.Update(func(data *Snapshot) error {
		if _, seen := data.Nonces[merchantID+":"+nonce]; seen {
			return errors.New("merchant request replay rejected")
		}
		data.Nonces[merchantID+":"+nonce] = NonceRecord{MerchantID: merchantID, Nonce: nonce, SeenAt: s.now()}
		for k, v := range data.Nonces {
			if s.now().Sub(v.SeenAt) > 10*time.Minute {
				delete(data.Nonces, k)
			}
		}
		return nil
	})
	return merchant, err
}

type CatalogInput struct {
	Name           string `json:"name"`
	Description    string `json:"description,omitempty"`
	Amount         int64  `json:"amount"`
	IdempotencyKey string `json:"idempotencyKey"`
}

func (s *Service) CreateCatalog(merchant Merchant, input CatalogInput) (CatalogItem, error) {
	if len(strings.TrimSpace(input.Name)) < 2 || input.Amount <= 0 {
		return CatalogItem{}, errors.New("catalog item requires name and positive amount")
	}
	key, err := validKey(input.IdempotencyKey)
	if err != nil {
		return CatalogItem{}, err
	}
	id := "cat_" + hashString(merchant.ID, key)[:20]
	now := s.now()
	item := CatalogItem{ID: id, MerchantID: merchant.ID, Name: strings.TrimSpace(input.Name), Description: strings.TrimSpace(input.Description), Amount: input.Amount, Asset: NativeAsset, Active: true, CreatedAt: now}
	err = s.idempotentUpdate("catalog", merchant.ID, key, hashJSON(input), id, func(data *Snapshot) error {
		data.Catalog[id] = item
		appendAudit(data, merchant.ID, merchant.ID, "catalog.create", id, "committed", "", now)
		return nil
	})
	if err != nil {
		return CatalogItem{}, err
	}
	return item, nil
}

type InvoiceInput struct {
	CatalogItemID    string `json:"catalogItemId,omitempty"`
	Description      string `json:"description,omitempty"`
	Amount           int64  `json:"amount,omitempty"`
	ExpiresInMinutes int64  `json:"expiresInMinutes"`
	IdempotencyKey   string `json:"idempotencyKey"`
}

func (s *Service) CreateInvoice(ctx context.Context, merchant Merchant, input InvoiceInput) (Invoice, error) {
	s.mutation.Lock()
	defer s.mutation.Unlock()
	key, err := validKey(input.IdempotencyKey)
	if err != nil {
		return Invoice{}, err
	}
	if input.ExpiresInMinutes < 1 || input.ExpiresInMinutes > 24*60 {
		return Invoice{}, errors.New("invoice expiry must be between 1 and 1440 minutes")
	}
	amount := input.Amount
	description := strings.TrimSpace(input.Description)
	var itemID string
	if input.CatalogItemID != "" {
		err = s.store.View(func(data Snapshot) error {
			item, ok := data.Catalog[input.CatalogItemID]
			if !ok || item.MerchantID != merchant.ID || !item.Active {
				return errors.New("catalog item is unavailable")
			}
			amount = item.Amount
			description = item.Name
			itemID = item.ID
			return nil
		})
		if err != nil {
			return Invoice{}, err
		}
	}
	if amount <= 0 {
		return Invoice{}, errors.New("invoice amount must be positive")
	}
	scope := "invoice:" + merchant.ID
	if existing, ok, err := s.idempotentInvoice(scope, key, hashJSON(input)); err != nil {
		return Invoice{}, err
	} else if ok {
		return existing, nil
	}
	intent, err := s.pay.CreateIntent(ctx, merchant.CentralMerchantID, merchant.PayoutAddress, amount, "product-intent-"+key)
	if err != nil {
		return Invoice{}, err
	}
	hours := (input.ExpiresInMinutes + 59) / 60
	central, err := s.pay.CreateInvoice(ctx, intent.ID, hours, "product-invoice-"+key)
	if err != nil {
		return Invoice{}, err
	}
	if central.Currency != NativeAsset || central.Amount != amount || central.Merchant != merchant.CentralMerchantID || central.PayoutAddress != merchant.PayoutAddress || central.Status != "issued" {
		return Invoice{}, errors.New("central Pay invoice did not match the merchant request")
	}
	expiry := s.now().Add(time.Duration(input.ExpiresInMinutes) * time.Minute)
	if central.DueAt.Before(expiry) {
		expiry = central.DueAt
	}
	invoice := Invoice{Version: InvoiceVersion, ID: "inv_" + hashString(central.ID, merchant.ID)[:20], CentralID: central.ID, IntentID: intent.ID, MerchantID: merchant.ID, MerchantName: merchant.DisplayName, PayoutAddress: merchant.PayoutAddress, CatalogItemID: itemID, Description: description, Amount: amount, Asset: NativeAsset, Network: ChainID, Fee: NativeFeeYNXT, Status: "pending", ExpiresAt: expiry, CreatedAt: s.now(), SignatureKeyID: merchant.ID + "-invoice-v1", SigningPublicKey: merchant.InvoiceSigningPublicKey, SignatureAlgorithm: "ed25519"}
	privateText, err := s.open(merchant.InvoiceSigningPrivateCipher)
	if err != nil {
		return Invoice{}, errors.New("merchant invoice signing key unavailable")
	}
	privateKey, err := base64.RawStdEncoding.DecodeString(privateText)
	if err != nil || len(privateKey) != ed25519.PrivateKeySize {
		return Invoice{}, errors.New("merchant invoice signing key invalid")
	}
	invoice.Signature = hex.EncodeToString(ed25519.Sign(ed25519.PrivateKey(privateKey), invoiceSigningMaterial(invoice)))
	err = s.idempotentUpdate("invoice", merchant.ID, key, hashJSON(input), invoice.ID, func(data *Snapshot) error {
		data.Invoices[invoice.ID] = invoice
		appendAudit(data, merchant.ID, merchant.ID, "invoice.create", invoice.ID, "committed", "central invoice "+central.ID, s.now())
		return nil
	})
	if err != nil {
		return Invoice{}, err
	}
	return invoice, nil
}

func (s *Service) Invoice(ctx context.Context, id string) (Invoice, error) {
	var invoice Invoice
	var merchant Merchant
	err := s.store.View(func(data Snapshot) error {
		var ok bool
		invoice, ok = data.Invoices[id]
		if !ok {
			return errors.New("invoice not found")
		}
		merchant = data.Merchants[invoice.MerchantID]
		return nil
	})
	if err != nil {
		return Invoice{}, err
	}
	if invoice.Status == "committed" {
		return invoice, nil
	}
	if !s.now().Before(invoice.ExpiresAt) {
		invoice.Status = "expired"
		_ = s.saveInvoice(invoice, "invoice.expired")
		return invoice, nil
	}
	settlement, err := s.pay.Settlement(ctx, invoice.CentralID)
	if err != nil {
		return invoice, nil
	}
	return s.acceptSettlement(invoice, merchant, settlement)
}
func (s *Service) SubmitSettlement(ctx context.Context, id, payer, tx, key string) (Invoice, error) {
	s.mutation.Lock()
	defer s.mutation.Unlock()
	invoice, err := s.Invoice(ctx, id)
	if err != nil {
		return Invoice{}, err
	}
	if invoice.Status == "expired" {
		return Invoice{}, errors.New("invoice expired")
	}
	settlement, err := s.pay.Settle(ctx, invoice.CentralID, payer, strings.ToLower(strings.TrimSpace(tx)), key)
	if err != nil {
		return Invoice{}, err
	}
	var merchant Merchant
	_ = s.store.View(func(data Snapshot) error { merchant = data.Merchants[invoice.MerchantID]; return nil })
	return s.acceptSettlement(invoice, merchant, settlement)
}
func (s *Service) acceptSettlement(invoice Invoice, merchant Merchant, v chain.PaySettlement) (Invoice, error) {
	if !validSettlementEvidence(invoice, merchant, v) {
		return Invoice{}, errors.New("authoritative settlement evidence is incomplete or mismatched")
	}
	invoice.Status = "committed"
	invoice.Settlement = &SettlementEvidence{ID: v.ID, TransactionHash: v.TransactionHash, BlockNumber: v.BlockNumber, Payer: v.Payer, PayoutAddress: v.PayoutAddress, Amount: v.Amount, Asset: v.Currency, Status: "committed", AuditHash: v.AuditHash, CommittedAt: v.CreatedAt, Source: "authoritative-central-pay-api"}
	if err := s.saveInvoice(invoice, "invoice.committed"); err != nil {
		return Invoice{}, err
	}
	_ = s.queueWebhook(merchant, "invoice.committed", invoice.ID)
	return invoice, nil
}

func validSettlementEvidence(invoice Invoice, merchant Merchant, v chain.PaySettlement) bool {
	return v.ID != "" &&
		v.Status == "paid" &&
		v.BlockNumber != 0 &&
		v.InvoiceID == invoice.CentralID &&
		v.IntentID == invoice.IntentID &&
		v.Merchant == merchant.CentralMerchantID &&
		v.PayoutAddress == invoice.PayoutAddress &&
		v.Amount == invoice.Amount &&
		v.Currency == NativeAsset &&
		strings.HasPrefix(v.TransactionHash, "0x") && len(v.TransactionHash) == 66 &&
		len(v.AuditHash) == 64
}
func (s *Service) saveInvoice(invoice Invoice, action string) error {
	return s.store.Update(func(data *Snapshot) error {
		data.Invoices[invoice.ID] = invoice
		appendAudit(data, invoice.MerchantID, "system", action, invoice.ID, "committed", "", s.now())
		return nil
	})
}

func (s *Service) RotateWebhookSecret(merchant Merchant) (string, error) {
	secret := randomToken(32)
	merchant.SecretVersion++
	merchant.WebhookSecretCipher = s.seal(secret)
	merchant.UpdatedAt = s.now()
	err := s.store.Update(func(data *Snapshot) error {
		data.Merchants[merchant.ID] = merchant
		appendAudit(data, merchant.ID, merchant.ID, "webhook.secret.rotate", merchant.ID, "committed", fmt.Sprintf("version %d", merchant.SecretVersion), s.now())
		return nil
	})
	return secret, err
}
func (s *Service) SetWebhook(merchant Merchant, endpoint string) error {
	v, err := validWebhookURL(endpoint)
	if err != nil {
		return err
	}
	merchant.WebhookURL = v
	merchant.UpdatedAt = s.now()
	return s.store.Update(func(data *Snapshot) error {
		data.Merchants[merchant.ID] = merchant
		appendAudit(data, merchant.ID, merchant.ID, "webhook.endpoint.update", merchant.ID, "committed", "", s.now())
		return nil
	})
}
func (s *Service) queueWebhook(merchant Merchant, event, objectID string) error {
	if merchant.WebhookURL == "" {
		return nil
	}
	now := s.now().UTC()
	payload, _ := json.Marshal(map[string]any{"event": event, "objectId": objectID, "merchantId": merchant.ID, "occurredAt": now})
	secret, err := s.open(merchant.WebhookSecretCipher)
	if err != nil {
		return err
	}
	id := "whd_" + hashString(event, objectID, fmt.Sprint(merchant.SecretVersion))[:20]
	payloadHash := hexSHA(payload)
	delivery := WebhookDelivery{ID: id, MerchantID: merchant.ID, EventType: event, ObjectID: objectID, Endpoint: merchant.WebhookURL, PayloadHash: payloadHash, Signature: hmacHex([]byte(secret), webhookSigningMaterial(id, now, payloadHash)), SecretVersion: merchant.SecretVersion, Status: "pending", CreatedAt: now, UpdatedAt: now}
	return s.store.Update(func(data *Snapshot) error {
		if _, ok := data.Deliveries[id]; !ok {
			data.Deliveries[id] = delivery
		}
		return nil
	})
}
func (s *Service) Deliver(ctx context.Context, id string) (WebhookDelivery, error) {
	s.mutation.Lock()
	defer s.mutation.Unlock()
	var d WebhookDelivery
	var merchant Merchant
	err := s.store.View(func(data Snapshot) error {
		var ok bool
		d, ok = data.Deliveries[id]
		if !ok {
			return errors.New("webhook delivery not found")
		}
		merchant = data.Merchants[d.MerchantID]
		return nil
	})
	if err != nil {
		return d, err
	}
	if d.Status == "delivered" {
		return d, nil
	}
	payload, _ := json.Marshal(map[string]any{"event": d.EventType, "objectId": d.ObjectID, "merchantId": d.MerchantID, "occurredAt": d.CreatedAt})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, d.Endpoint, strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-Event-ID", d.ID)
	req.Header.Set("X-YNX-Delivery-ID", d.ID)
	req.Header.Set("X-YNX-Timestamp", d.CreatedAt.UTC().Format(time.RFC3339Nano))
	req.Header.Set("X-YNX-Payload-SHA256", d.PayloadHash)
	req.Header.Set("X-YNX-Signature-Version", fmt.Sprint(d.SecretVersion))
	req.Header.Set("X-YNX-Signature", "v"+fmt.Sprint(d.SecretVersion)+"="+d.Signature)
	resp, sendErr := s.client.Do(req)
	d.Attempt++
	d.UpdatedAt = s.now()
	if sendErr == nil {
		d.HTTPStatus = resp.StatusCode
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
		_ = resp.Body.Close()
	}
	if sendErr == nil && d.HTTPStatus >= 200 && d.HTTPStatus < 300 {
		d.Status = "delivered"
	} else {
		d.Status = "retrying"
		if d.Attempt >= 5 {
			d.Status = "failed"
		} else {
			d.NextAttemptAt = s.now().Add(time.Duration(1<<min(d.Attempt, 6)) * time.Minute)
		}
	}
	err = s.store.Update(func(data *Snapshot) error {
		data.Deliveries[id] = d
		outcome := d.Status
		if sendErr != nil {
			outcome += " " + sendErr.Error()
		}
		appendAudit(data, merchant.ID, "system", "webhook.deliver", id, outcome, "", s.now())
		return nil
	})
	return d, err
}

func webhookSigningMaterial(id string, timestamp time.Time, payloadHash string) []byte {
	return []byte(strings.Join([]string{"YNX_PAY_WEBHOOK_V1", id, timestamp.UTC().Format(time.RFC3339Nano), payloadHash}, "\n"))
}

func (s *Service) RetryDue(ctx context.Context) []WebhookDelivery {
	ids := []string{}
	_ = s.store.View(func(data Snapshot) error {
		for id, delivery := range data.Deliveries {
			if (delivery.Status == "pending" || delivery.Status == "retrying") && (delivery.NextAttemptAt.IsZero() || !delivery.NextAttemptAt.After(s.now())) {
				ids = append(ids, id)
			}
		}
		return nil
	})
	sort.Strings(ids)
	results := make([]WebhookDelivery, 0, len(ids))
	for _, id := range ids {
		delivery, err := s.Deliver(ctx, id)
		if err == nil {
			results = append(results, delivery)
		}
	}
	return results
}

func (s *Service) Analytics(merchantID string) (Analytics, error) {
	out := Analytics{MerchantID: merchantID, GeneratedAt: s.now(), Source: "persistent-product-records-and-authoritative-settlements"}
	err := s.store.View(func(data Snapshot) error {
		if _, ok := data.Merchants[merchantID]; !ok {
			return errors.New("merchant not found")
		}
		for _, v := range data.Invoices {
			if v.MerchantID == merchantID {
				out.InvoiceCount++
				if v.Status == "committed" && v.Settlement != nil {
					out.CommittedCount++
					out.GrossYNXT += v.Amount
				}
			}
		}
		for _, v := range data.Refunds {
			if v.MerchantID == merchantID {
				out.RefundRequestCount++
			}
		}
		for _, v := range data.Disputes {
			if v.MerchantID == merchantID {
				out.DisputeCount++
			}
		}
		for _, v := range data.Deliveries {
			if v.MerchantID == merchantID && v.Status == "failed" {
				out.FailedWebhookCount++
			}
		}
		return nil
	})
	return out, err
}
func (s *Service) Export(merchantID string) ([]Invoice, error) {
	out := []Invoice{}
	err := s.store.View(func(data Snapshot) error {
		for _, v := range data.Invoices {
			if v.MerchantID == merchantID {
				out = append(out, v)
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
		return nil
	})
	return out, err
}
func (s *Service) SnapshotForMerchant(merchantID string) (Snapshot, error) {
	var out Snapshot
	err := s.store.View(func(data Snapshot) error {
		out = emptySnapshot()
		if m, ok := data.Merchants[merchantID]; ok {
			out.Merchants[merchantID] = publicMerchant(m)
		} else {
			return errors.New("merchant not found")
		}
		for k, v := range data.Catalog {
			if v.MerchantID == merchantID {
				out.Catalog[k] = v
			}
		}
		for k, v := range data.MerchantMembers {
			if v.MerchantID == merchantID {
				out.MerchantMembers[k] = v
			}
		}
		for k, v := range data.Invoices {
			if v.MerchantID == merchantID {
				out.Invoices[k] = v
			}
		}
		for k, v := range data.Refunds {
			if v.MerchantID == merchantID {
				out.Refunds[k] = v
			}
		}
		for k, v := range data.Disputes {
			if v.MerchantID == merchantID {
				out.Disputes[k] = v
			}
		}
		for k, v := range data.Deliveries {
			if v.MerchantID == merchantID {
				out.Deliveries[k] = v
			}
		}
		for k, v := range data.AIRuns {
			if v.MerchantID == merchantID {
				out.AIRuns[k] = v
			}
		}
		for k, v := range data.Providers {
			if v.MerchantID == merchantID {
				out.Providers[k] = publicProviderConnection(v)
			}
		}
		for _, v := range data.Audit {
			if v.MerchantID == merchantID {
				out.Audit = append(out.Audit, v)
			}
		}
		out.Idempotency = nil
		out.Nonces = nil
		out.ConsoleSessions = nil
		out.GatewaySeen = nil
		return nil
	})
	return out, err
}

func (s *Service) idempotentInvoice(scope, key, requestHash string) (Invoice, bool, error) {
	var out Invoice
	var ok bool
	err := s.store.View(func(data Snapshot) error {
		if r, found := data.Idempotency[scope+":"+key]; found {
			if r.RequestHash != requestHash {
				return errors.New("idempotency key reused with different request")
			}
			out, ok = data.Invoices[r.ObjectID]
		}
		return nil
	})
	return out, ok, err
}
func (s *Service) idempotentUpdate(scope, merchant, key, requestHash, objectID string, fn func(*Snapshot) error) error {
	return s.store.Update(func(data *Snapshot) error {
		id := scope + ":" + merchant + ":" + key
		if existing, ok := data.Idempotency[id]; ok {
			if existing.RequestHash != requestHash {
				return errors.New("idempotency key reused with different request")
			}
			return nil
		}
		if err := fn(data); err != nil {
			return err
		}
		data.Idempotency[id] = IdempotencyRecord{Scope: scope, Key: key, RequestHash: requestHash, ObjectID: objectID, CreatedAt: s.now()}
		return nil
	})
}
func (s *Service) seal(value string) string {
	block, _ := aes.NewCipher(s.key[:32])
	aead, _ := cipher.NewGCM(block)
	nonce := make([]byte, aead.NonceSize())
	_, _ = rand.Read(nonce)
	return base64.RawStdEncoding.EncodeToString(append(nonce, aead.Seal(nil, nonce, []byte(value), []byte("YNX_PAY_PRODUCT_SECRET_V1"))...))
}
func (s *Service) open(value string) (string, error) {
	raw, err := base64.RawStdEncoding.DecodeString(value)
	if err != nil {
		return "", err
	}
	block, _ := aes.NewCipher(s.key[:32])
	aead, _ := cipher.NewGCM(block)
	if len(raw) < aead.NonceSize() {
		return "", errors.New("secret ciphertext invalid")
	}
	plain, err := aead.Open(nil, raw[:aead.NonceSize()], raw[aead.NonceSize():], []byte("YNX_PAY_PRODUCT_SECRET_V1"))
	return string(plain), err
}
func publicMerchant(m Merchant) Merchant {
	m.SecretHash = ""
	m.CredentialCipher = ""
	m.WebhookSecretCipher = ""
	m.InvoiceSigningPrivateCipher = ""
	return m
}
func invoiceSigningMaterial(v Invoice) []byte {
	return []byte(strings.Join([]string{"YNX_PAY_INVOICE_V1", fmt.Sprint(v.Version), v.ID, v.CentralID, v.IntentID, v.MerchantID, v.MerchantName, v.PayoutAddress, fmt.Sprint(v.Amount), v.Asset, v.Network, fmt.Sprint(v.Fee), v.ExpiresAt.UTC().Format(time.RFC3339Nano), v.CreatedAt.UTC().Format(time.RFC3339Nano), v.SignatureKeyID, v.SigningPublicKey, v.SignatureAlgorithm}, "|"))
}
func appendAudit(data *Snapshot, merchant, actor, action, object, outcome, detail string, at time.Time) {
	data.Audit = append(data.Audit, AuditEntry{ID: "aud_" + hashString(merchant, action, object, at.Format(time.RFC3339Nano))[:20], MerchantID: merchant, Actor: actor, Action: action, ObjectID: object, Outcome: outcome, Detail: detail, At: at})
}
func validKey(v string) (string, error) {
	v = strings.TrimSpace(v)
	if len(v) < 8 || len(v) > 128 || !identifierRE.MatchString(v) {
		return "", errors.New("idempotency key must contain 8 to 128 safe characters")
	}
	return v, nil
}
func validWebhookURL(v string) (string, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return "", nil
	}
	u, err := url.Parse(v)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return "", errors.New("webhook endpoint must be absolute HTTPS without userinfo")
	}
	return u.String(), nil
}
func hashJSON(v any) string         { raw, _ := json.Marshal(v); return hexSHA(raw) }
func hexSHA(v []byte) string        { h := sha256.Sum256(v); return hex.EncodeToString(h[:]) }
func hashString(v ...string) string { return hexSHA([]byte(strings.Join(v, "|"))) }
func hmacHex(key, msg []byte) string {
	h := hmac.New(sha256.New, key)
	_, _ = h.Write(msg)
	return hex.EncodeToString(h.Sum(nil))
}
func randomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
func absDuration(v time.Duration) time.Duration {
	if v < 0 {
		return -v
	}
	return v
}
