package payproduct

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	secpECDSA "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

const (
	walletAuthVersion     = "1"
	walletProduct         = "pay"
	walletProductClientID = "ynx-pay-v1"
	walletBundleID        = "com.ynxweb4.pay"
	walletCallback        = "ynxpay://wallet-auth/callback"
	walletDeviceAlgorithm = "p256-sha256"
	walletPayIntentDomain = "YNX_PAY_SIGNED_INTENT_V1"
	walletPayResultDomain = "YNX_PAY_WALLET_RESULT_V1"
	walletMaximumLifetime = 5 * time.Minute
)

var (
	walletNoncePattern     = regexp.MustCompile(`^[A-Za-z0-9_-]{32,64}$`)
	walletDigestPattern    = regexp.MustCompile(`^[0-9a-f]{64}$`)
	walletSignaturePattern = regexp.MustCompile(`^[0-9a-f]{128}$`)
	walletTxPattern        = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
	walletAccountPattern   = regexp.MustCompile(`^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$`)
)

var walletScopes = []string{"account:read", "pay:case:create", "pay:settlement:submit"}

type SignedPaymentIntent struct {
	Version          string `json:"version"`
	IntentType       string `json:"intentType"`
	RequestID        string `json:"requestId"`
	ChainID          string `json:"chainId"`
	ProductClientID  string `json:"productClientId"`
	BundleID         string `json:"bundleId"`
	SessionBinding   string `json:"sessionBinding"`
	InvoiceID        string `json:"invoiceId"`
	CentralInvoiceID string `json:"centralInvoiceId"`
	MerchantID       string `json:"merchantId"`
	MerchantName     string `json:"merchantName"`
	PayoutAddress    string `json:"payoutAddress"`
	Amount           int64  `json:"amount"`
	Asset            string `json:"asset"`
	Fee              int64  `json:"fee"`
	Total            int64  `json:"total"`
	QuoteIssuedAt    string `json:"quoteIssuedAt"`
	QuoteExpiresAt   string `json:"quoteExpiresAt"`
	InvoiceSignature string `json:"invoiceSignature"`
	Callback         string `json:"callback"`
}

type WalletPaymentResult struct {
	Version          string `json:"version"`
	IntentDigest     string `json:"intentDigest"`
	RequestID        string `json:"requestId"`
	InvoiceID        string `json:"invoiceId"`
	ChainID          string `json:"chainId"`
	Account          string `json:"account"`
	AccountPublicKey string `json:"accountPublicKey"`
	TransactionHash  string `json:"transactionHash"`
	IssuedAt         string `json:"issuedAt"`
	WalletSignature  string `json:"walletSignature"`
}

func (s *Service) SubmitSignedSettlement(ctx context.Context, session WalletSession, invoiceID string, intent SignedPaymentIntent, result WalletPaymentResult, key string) (Invoice, error) {
	invoice, err := s.Invoice(ctx, invoiceID)
	if err != nil {
		return Invoice{}, err
	}
	if err := validatePaymentIntent(intent, invoice, session, s.now().UTC()); err != nil {
		return Invoice{}, err
	}
	intentDigest := digestCanonical(walletPayIntentDomain, intent)
	if err := validateWalletPaymentResult(result, intent, intentDigest, session, s.now().UTC()); err != nil {
		return Invoice{}, err
	}
	if err := verifyPaymentResultSignature(result); err != nil {
		return Invoice{}, err
	}
	if invoice.Status == "committed" && invoice.Settlement != nil && invoice.Settlement.TransactionHash == result.TransactionHash {
		return invoice, nil
	}
	requestHash := hashCanonical(map[string]any{"intent": intent, "result": result})
	var previous IdempotencyRecord
	_ = s.store.View(func(data Snapshot) error {
		previous = data.Idempotency["wallet-payment-result:"+result.TransactionHash]
		return nil
	})
	if previous.Key != "" && (previous.RequestHash != requestHash || previous.ObjectID != invoiceID) {
		return Invoice{}, errors.New("wallet payment result replay rejected")
	}
	settled, err := s.SubmitSettlement(ctx, invoiceID, session.Account, result.TransactionHash, key)
	if err != nil {
		return Invoice{}, err
	}
	err = s.store.Update(func(data *Snapshot) error {
		mapKey := "wallet-payment-result:" + result.TransactionHash
		if current, exists := data.Idempotency[mapKey]; exists && (current.RequestHash != requestHash || current.ObjectID != invoiceID) {
			return errors.New("wallet payment result replay rejected")
		}
		data.Idempotency[mapKey] = IdempotencyRecord{Scope: "wallet-payment-result", Key: result.TransactionHash, RequestHash: requestHash, ObjectID: invoiceID, CreatedAt: s.now()}
		appendAudit(data, invoice.MerchantID, "wallet:"+session.Account, "payment.signed-intent.accept", invoiceID, "committed", intentDigest, s.now())
		return nil
	})
	return settled, err
}

func validatePaymentIntent(intent SignedPaymentIntent, invoice Invoice, session WalletSession, now time.Time) error {
	issued, err := strictMilliseconds(intent.QuoteIssuedAt)
	if err != nil {
		return errors.New("payment quote issue time is invalid")
	}
	expires, err := strictMilliseconds(intent.QuoteExpiresAt)
	if err != nil {
		return errors.New("payment quote expiry is invalid")
	}
	if intent.Version != walletAuthVersion || intent.IntentType != "pay.ynxt.transfer" || !walletNoncePattern.MatchString(intent.RequestID) || intent.ChainID != ChainID || intent.ProductClientID != session.ProductClientID || intent.BundleID != session.BundleID || intent.SessionBinding != session.SessionBinding || intent.Callback != "ynxpay://payment-result" {
		return errors.New("payment intent product or session binding is invalid")
	}
	if intent.InvoiceID != invoice.ID || intent.CentralInvoiceID != invoice.CentralID || intent.MerchantID != invoice.MerchantID || intent.MerchantName != invoice.MerchantName || intent.PayoutAddress != invoice.PayoutAddress || intent.Amount != invoice.Amount || intent.Asset != invoice.Asset || intent.Fee != invoice.Fee || intent.Total != invoice.Amount+invoice.Fee || intent.InvoiceSignature != invoice.Signature {
		return errors.New("payment intent does not match the signed invoice and quote")
	}
	if issued.After(now.Add(30*time.Second)) || !expires.After(now) || expires.Sub(issued) <= 0 || expires.Sub(issued) > walletMaximumLifetime || expires.After(invoice.ExpiresAt) {
		return errors.New("payment quote is expired or exceeds the invoice lifetime")
	}
	return nil
}

func validateWalletPaymentResult(result WalletPaymentResult, intent SignedPaymentIntent, intentDigest string, session WalletSession, now time.Time) error {
	issued, err := strictMilliseconds(result.IssuedAt)
	if err != nil || issued.After(now.Add(30*time.Second)) || issued.Before(timeMust(intent.QuoteIssuedAt)) || issued.After(timeMust(intent.QuoteExpiresAt)) {
		return errors.New("wallet payment result time is invalid")
	}
	if result.Version != walletAuthVersion || result.IntentDigest != intentDigest || result.RequestID != intent.RequestID || result.InvoiceID != intent.InvoiceID || result.ChainID != ChainID || result.Account != session.Account || !walletDigestPattern.MatchString(result.IntentDigest) || !walletTxPattern.MatchString(result.TransactionHash) || !walletSignaturePattern.MatchString(result.WalletSignature) {
		return errors.New("wallet payment result does not match the reviewed intent or session")
	}
	return nil
}

func verifyPaymentResultSignature(result WalletPaymentResult) error {
	unsigned := map[string]any{"version": result.Version, "intentDigest": result.IntentDigest, "requestId": result.RequestID, "invoiceId": result.InvoiceID, "chainId": result.ChainID, "account": result.Account, "accountPublicKey": result.AccountPublicKey, "transactionHash": result.TransactionHash, "issuedAt": result.IssuedAt}
	return verifyCompactWalletSignature(result.Account, result.AccountPublicKey, result.WalletSignature, walletPayResultDomain+"\n"+string(mustCanonical(unsigned)))
}

func verifyCompactWalletSignature(account, publicKeyHex, signatureHex, signText string) error {
	publicKeyBytes, err := hex.DecodeString(publicKeyHex)
	if err != nil || len(publicKeyBytes) != 33 {
		return errors.New("wallet account public key is invalid")
	}
	publicKey, err := secp256k1.ParsePubKey(publicKeyBytes)
	if err != nil {
		return errors.New("wallet account public key is invalid")
	}
	derived, err := consensus.NativeAddress(publicKey.SerializeCompressed())
	if err == nil {
		derived, err = accountaddress.Encode(derived)
	}
	if err != nil || derived != account {
		return errors.New("wallet account public key does not match the native account")
	}
	signatureBytes, err := hex.DecodeString(signatureHex)
	if err != nil || len(signatureBytes) != 64 {
		return errors.New("wallet compact signature is invalid")
	}
	var r, ss secp256k1.ModNScalar
	if r.SetByteSlice(signatureBytes[:32]) || ss.SetByteSlice(signatureBytes[32:]) || r.IsZero() || ss.IsZero() || ss.IsOverHalfOrder() {
		return errors.New("wallet compact signature is invalid or not low-S")
	}
	digest := sha256.Sum256([]byte(signText))
	if !secpECDSA.NewSignature(&r, &ss).Verify(digest[:], publicKey) {
		return errors.New("wallet compact signature verification failed")
	}
	return nil
}

func digestCanonical(domain string, value any) string {
	digest := sha256.Sum256([]byte(domain + "\n" + string(mustCanonical(value))))
	return hex.EncodeToString(digest[:])
}

func hashCanonical(value any) string {
	digest := sha256.Sum256(mustCanonical(value))
	return hex.EncodeToString(digest[:])
}

func mustCanonical(value any) []byte {
	raw, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var decoded any
	if err := decoder.Decode(&decoded); err != nil {
		panic(err)
	}
	var canonical bytes.Buffer
	if err := writeCanonicalJSON(&canonical, decoded); err != nil {
		panic(err)
	}
	return canonical.Bytes()
}

func writeCanonicalJSON(out *bytes.Buffer, value any) error {
	switch typed := value.(type) {
	case nil:
		out.WriteString("null")
	case bool:
		if typed {
			out.WriteString("true")
		} else {
			out.WriteString("false")
		}
	case string:
		out.Write(canonicalJSONString(typed))
	case json.Number:
		integer, err := strconv.ParseInt(typed.String(), 10, 64)
		if err != nil || integer < -(1<<53-1) || integer > 1<<53-1 {
			return errors.New("protocol number is not a safe integer")
		}
		out.WriteString(strconv.FormatInt(integer, 10))
	case []any:
		out.WriteByte('[')
		for index, item := range typed {
			if index > 0 {
				out.WriteByte(',')
			}
			if err := writeCanonicalJSON(out, item); err != nil {
				return err
			}
		}
		out.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		out.WriteByte('{')
		for index, key := range keys {
			if index > 0 {
				out.WriteByte(',')
			}
			out.Write(canonicalJSONString(key))
			out.WriteByte(':')
			if err := writeCanonicalJSON(out, typed[key]); err != nil {
				return err
			}
		}
		out.WriteByte('}')
	default:
		return fmt.Errorf("unsupported canonical JSON type %T", value)
	}
	return nil
}

func canonicalJSONString(value string) []byte {
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		panic(err)
	}
	return bytes.TrimSuffix(encoded.Bytes(), []byte("\n"))
}

func strictMilliseconds(value string) (time.Time, error) {
	parsed, err := time.Parse("2006-01-02T15:04:05.000Z", value)
	if err != nil || parsed.Format("2006-01-02T15:04:05.000Z") != value {
		return time.Time{}, errors.New("timestamp must be canonical millisecond UTC")
	}
	return parsed, nil
}

func timeMust(value string) time.Time { parsed, _ := strictMilliseconds(value); return parsed }

func sameStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func (s *Service) CreateRefundRequest(session WalletSession, invoiceID string, amount int64, reason, key string) (RefundRequest, error) {
	invoice, err := s.Invoice(context.Background(), invoiceID)
	if err != nil {
		return RefundRequest{}, err
	}
	if invoice.Settlement == nil || invoice.Settlement.Payer != session.Account {
		return RefundRequest{}, errors.New("only the committed payer can request a refund")
	}
	if amount <= 0 || amount > invoice.Amount {
		return RefundRequest{}, errors.New("refund request amount is invalid")
	}
	if len(strings.TrimSpace(reason)) < 8 {
		return RefundRequest{}, errors.New("refund request reason is too short")
	}
	key, err = validKey(key)
	if err != nil {
		return RefundRequest{}, err
	}
	id := "rfr_" + hashString(invoiceID, session.Account, key)[:20]
	now := s.now()
	request := RefundRequest{ID: id, InvoiceID: invoiceID, MerchantID: invoice.MerchantID, Payer: session.Account, Amount: amount, Reason: strings.TrimSpace(reason), Status: "requested", CreatedAt: now, UpdatedAt: now}
	err = s.idempotentUpdate("refund-request", session.Account, key, hashJSON(request), id, func(data *Snapshot) error {
		data.Refunds[id] = request
		appendAudit(data, invoice.MerchantID, "wallet:"+session.Account, "refund.request", id, "committed", "human merchant action required", now)
		return nil
	})
	return request, err
}

func (s *Service) CreateDispute(session WalletSession, invoiceID, reason, key string, evidence []string) (Dispute, error) {
	invoice, err := s.Invoice(context.Background(), invoiceID)
	if err != nil {
		return Dispute{}, err
	}
	if invoice.Settlement == nil || invoice.Settlement.Payer != session.Account {
		return Dispute{}, errors.New("only the committed payer can open a dispute")
	}
	if len(strings.TrimSpace(reason)) < 8 {
		return Dispute{}, errors.New("dispute reason is too short")
	}
	if len(evidence) > 20 {
		return Dispute{}, errors.New("too many Trust evidence references")
	}
	for _, v := range evidence {
		if !identifierRE.MatchString(v) {
			return Dispute{}, errors.New("invalid Trust evidence reference")
		}
	}
	key, err = validKey(key)
	if err != nil {
		return Dispute{}, err
	}
	id := "dsp_" + hashString(invoiceID, session.Account, key)[:20]
	now := s.now()
	d := Dispute{ID: id, InvoiceID: invoiceID, MerchantID: invoice.MerchantID, Payer: session.Account, Reason: strings.TrimSpace(reason), TrustEvidence: evidence, Status: "open", CreatedAt: now, UpdatedAt: now}
	err = s.idempotentUpdate("dispute", session.Account, key, hashJSON(d), id, func(data *Snapshot) error {
		data.Disputes[id] = d
		appendAudit(data, invoice.MerchantID, "wallet:"+session.Account, "dispute.open", id, "committed", "Trust review required", now)
		return nil
	})
	return d, err
}
