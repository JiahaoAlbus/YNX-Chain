package payproduct

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/base64"
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
	walletRequestDomain   = "YNX_WALLET_AUTH_REQUEST_V1"
	walletApprovalDomain  = "YNX_WALLET_AUTH_APPROVAL_V1"
	walletGatewayDomain   = "YNX_PRODUCT_SESSION_CHALLENGE_V1"
	walletPayIntentDomain = "YNX_PAY_SIGNED_INTENT_V1"
	walletPayResultDomain = "YNX_PAY_WALLET_RESULT_V1"
	walletMaximumLifetime = 5 * time.Minute
	walletSessionLifetime = 8 * time.Hour
)

var (
	walletNoncePattern     = regexp.MustCompile(`^[A-Za-z0-9_-]{32,64}$`)
	walletDeviceKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{44}$`)
	walletDigestPattern    = regexp.MustCompile(`^[0-9a-f]{64}$`)
	walletSignaturePattern = regexp.MustCompile(`^[0-9a-f]{128}$`)
	walletTxPattern        = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
	walletAccountPattern   = regexp.MustCompile(`^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$`)
)

var walletScopes = []string{"account:read", "pay:case:create", "pay:settlement:submit"}

type WalletAuthorizationRequest struct {
	Version                string   `json:"version"`
	Nonce                  string   `json:"nonce"`
	ChainID                string   `json:"chainId"`
	RequestingProduct      string   `json:"requestingProduct"`
	ProductClientID        string   `json:"productClientId"`
	BundleID               string   `json:"bundleId"`
	ProductDeviceAlgorithm string   `json:"productDeviceAlgorithm"`
	ProductDeviceKey       string   `json:"productDeviceKey"`
	Callback               string   `json:"callback"`
	Scopes                 []string `json:"scopes"`
	Purpose                string   `json:"purpose"`
	IssuedAt               string   `json:"issuedAt"`
	ExpiresAt              string   `json:"expiresAt"`
}

type WalletAuthorizationResponse struct {
	Version                string   `json:"version"`
	RequestDigest          string   `json:"requestDigest"`
	Nonce                  string   `json:"nonce"`
	ChainID                string   `json:"chainId"`
	RequestingProduct      string   `json:"requestingProduct"`
	ProductClientID        string   `json:"productClientId"`
	BundleID               string   `json:"bundleId"`
	ProductDeviceAlgorithm string   `json:"productDeviceAlgorithm"`
	ProductDeviceKey       string   `json:"productDeviceKey"`
	Callback               string   `json:"callback"`
	Account                string   `json:"account"`
	AccountPublicKey       string   `json:"accountPublicKey"`
	GrantedScopes          []string `json:"grantedScopes"`
	Purpose                string   `json:"purpose"`
	IssuedAt               string   `json:"issuedAt"`
	ExpiresAt              string   `json:"expiresAt"`
	WalletSignature        string   `json:"walletSignature"`
}

type GatewayChallenge struct {
	Version                string   `json:"version"`
	Challenge              string   `json:"challenge"`
	RequestDigest          string   `json:"requestDigest"`
	ProductClientID        string   `json:"productClientId"`
	BundleID               string   `json:"bundleId"`
	ProductDeviceAlgorithm string   `json:"productDeviceAlgorithm"`
	ProductDeviceKey       string   `json:"productDeviceKey"`
	Account                string   `json:"account"`
	Scopes                 []string `json:"scopes"`
	IssuedAt               string   `json:"issuedAt"`
	ExpiresAt              string   `json:"expiresAt"`
}

type GatewayCompletion struct {
	Challenge       GatewayChallenge `json:"challenge"`
	DeviceSignature string           `json:"deviceSignature"`
}

type WalletSessionInput struct {
	Request    WalletAuthorizationRequest  `json:"request"`
	Approval   WalletAuthorizationResponse `json:"approval"`
	Completion GatewayCompletion           `json:"completion"`
}

type WalletSessionResult struct {
	SessionID      string    `json:"sessionId"`
	Token          string    `json:"token"`
	Account        string    `json:"account"`
	SessionBinding string    `json:"sessionBinding"`
	Scopes         []string  `json:"scopes"`
	ExpiresAt      time.Time `json:"expiresAt"`
}

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

func (s *Service) CompleteWalletSession(input WalletSessionInput) (WalletSessionResult, error) {
	now := s.now().UTC()
	requestIssued, requestExpires, err := validateWalletAuthorizationRequest(input.Request, now)
	if err != nil {
		return WalletSessionResult{}, err
	}
	requestDigest := digestCanonical(walletRequestDomain, input.Request)
	approvalIssued, approvalExpires, err := validateWalletApproval(input.Approval, input.Request, requestDigest, now)
	if err != nil {
		return WalletSessionResult{}, err
	}
	if approvalIssued.Before(requestIssued) || approvalExpires.After(requestExpires) {
		return WalletSessionResult{}, errors.New("wallet approval lifetime exceeds the authorization request")
	}
	if err := verifyWalletApprovalSignature(input.Approval); err != nil {
		return WalletSessionResult{}, err
	}
	challengeIssued, challengeExpires, err := validateGatewayCompletion(input.Completion, input.Approval, now)
	if err != nil {
		return WalletSessionResult{}, err
	}
	if challengeIssued.Before(approvalIssued) || challengeExpires.After(approvalExpires) {
		return WalletSessionResult{}, errors.New("gateway challenge exceeds the Wallet approval lifetime")
	}
	if err := verifyGatewayDeviceProof(input.Completion); err != nil {
		return WalletSessionResult{}, err
	}

	nowStored := s.now().UTC()
	var replay WalletChallenge
	_ = s.store.View(func(data Snapshot) error { replay = data.WalletChallenges[input.Request.Nonce]; return nil })
	if replay.Nonce != "" {
		return WalletSessionResult{}, errors.New("wallet authorization replay rejected")
	}

	token := randomToken(32)
	sessionBinding := hashCanonical(input.Completion.Challenge)
	expiresAt := nowStored.Add(walletSessionLifetime)
	if expiresAt.After(challengeExpires) {
		expiresAt = challengeExpires
	}
	session := WalletSession{
		ID: "wss_" + randomToken(12), Account: input.Approval.Account, ProductClientID: walletProductClientID,
		BundleID: walletBundleID, ProductDeviceAlgorithm: walletDeviceAlgorithm, ProductDeviceKey: input.Request.ProductDeviceKey,
		SessionBinding: sessionBinding, TokenHash: hashString(token), Scopes: append([]string(nil), walletScopes...), ExpiresAt: expiresAt,
	}
	err = s.store.Update(func(data *Snapshot) error {
		if _, exists := data.WalletChallenges[input.Request.Nonce]; exists {
			return errors.New("wallet authorization replay rejected")
		}
		usedAt := nowStored
		data.WalletChallenges[input.Request.Nonce] = WalletChallenge{Nonce: input.Request.Nonce, RequestDigest: requestDigest, ExpiresAt: requestExpires, UsedAt: &usedAt}
		data.WalletSessions[session.ID] = session
		appendAudit(data, "", "wallet:"+session.Account, "wallet.gateway-session.complete", session.ID, "committed", sessionBinding, nowStored)
		return nil
	})
	if err != nil {
		return WalletSessionResult{}, err
	}
	return WalletSessionResult{SessionID: session.ID, Token: token, Account: session.Account, SessionBinding: session.SessionBinding, Scopes: session.Scopes, ExpiresAt: session.ExpiresAt}, nil
}

func (s *Service) AuthenticateWallet(header string) (WalletSession, error) {
	value := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	parts := strings.SplitN(value, ".", 2)
	if len(parts) != 2 {
		return WalletSession{}, errors.New("wallet session required")
	}
	var session WalletSession
	err := s.store.View(func(data Snapshot) error {
		var ok bool
		session, ok = data.WalletSessions[parts[0]]
		if !ok || session.RevokedAt != nil || !s.now().Before(session.ExpiresAt) {
			return errors.New("wallet session is invalid or expired")
		}
		if session.ProductClientID != walletProductClientID || session.BundleID != walletBundleID || session.ProductDeviceAlgorithm != walletDeviceAlgorithm || !sameStrings(session.Scopes, walletScopes) || !hmacEqual(session.TokenHash, hashString(parts[1])) {
			return errors.New("wallet session binding is invalid")
		}
		return nil
	})
	return session, err
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

func validateWalletAuthorizationRequest(request WalletAuthorizationRequest, now time.Time) (time.Time, time.Time, error) {
	issued, err := strictMilliseconds(request.IssuedAt)
	if err != nil {
		return time.Time{}, time.Time{}, errors.New("wallet authorization issuedAt is invalid")
	}
	expires, err := strictMilliseconds(request.ExpiresAt)
	if err != nil {
		return time.Time{}, time.Time{}, errors.New("wallet authorization expiresAt is invalid")
	}
	if request.Version != walletAuthVersion || request.ChainID != ChainID || request.RequestingProduct != walletProduct || request.ProductClientID != walletProductClientID || request.BundleID != walletBundleID || request.ProductDeviceAlgorithm != walletDeviceAlgorithm || request.Callback != walletCallback || !sameStrings(request.Scopes, walletScopes) || strings.TrimSpace(request.Purpose) == "" {
		return time.Time{}, time.Time{}, errors.New("wallet authorization product, network, callback, or scopes are invalid")
	}
	if !walletNoncePattern.MatchString(request.Nonce) || !validP256DeviceKey(request.ProductDeviceKey) {
		return time.Time{}, time.Time{}, errors.New("wallet authorization nonce or product device key is invalid")
	}
	if expires.Sub(issued) <= 0 || expires.Sub(issued) > walletMaximumLifetime || issued.After(now.Add(30*time.Second)) || !expires.After(now) {
		return time.Time{}, time.Time{}, errors.New("wallet authorization lifetime is invalid or expired")
	}
	return issued, expires, nil
}

func validateWalletApproval(approval WalletAuthorizationResponse, request WalletAuthorizationRequest, requestDigest string, now time.Time) (time.Time, time.Time, error) {
	issued, err := strictMilliseconds(approval.IssuedAt)
	if err != nil {
		return time.Time{}, time.Time{}, errors.New("wallet approval issuedAt is invalid")
	}
	expires, err := strictMilliseconds(approval.ExpiresAt)
	if err != nil {
		return time.Time{}, time.Time{}, errors.New("wallet approval expiresAt is invalid")
	}
	if approval.Version != request.Version || approval.RequestDigest != requestDigest || approval.Nonce != request.Nonce || approval.ChainID != request.ChainID || approval.RequestingProduct != request.RequestingProduct || approval.ProductClientID != request.ProductClientID || approval.BundleID != request.BundleID || approval.ProductDeviceAlgorithm != request.ProductDeviceAlgorithm || approval.ProductDeviceKey != request.ProductDeviceKey || approval.Callback != request.Callback || approval.Purpose != request.Purpose || !sameStrings(approval.GrantedScopes, request.Scopes) {
		return time.Time{}, time.Time{}, errors.New("wallet approval does not match the exact product request")
	}
	if !walletDigestPattern.MatchString(approval.RequestDigest) || !walletSignaturePattern.MatchString(approval.WalletSignature) || !walletAccountPattern.MatchString(approval.Account) || !regexp.MustCompile(`^(02|03)[0-9a-f]{64}$`).MatchString(approval.AccountPublicKey) || !expires.After(issued) || !expires.After(now) {
		return time.Time{}, time.Time{}, errors.New("wallet approval signature fields or lifetime are invalid")
	}
	return issued, expires, nil
}

func validateGatewayCompletion(completion GatewayCompletion, approval WalletAuthorizationResponse, now time.Time) (time.Time, time.Time, error) {
	c := completion.Challenge
	issued, err := strictMilliseconds(c.IssuedAt)
	if err != nil {
		return time.Time{}, time.Time{}, errors.New("gateway challenge issuedAt is invalid")
	}
	expires, err := strictMilliseconds(c.ExpiresAt)
	if err != nil {
		return time.Time{}, time.Time{}, errors.New("gateway challenge expiresAt is invalid")
	}
	if c.Version != walletAuthVersion || !walletNoncePattern.MatchString(c.Challenge) || c.RequestDigest != approval.RequestDigest || c.ProductClientID != approval.ProductClientID || c.BundleID != approval.BundleID || c.ProductDeviceAlgorithm != approval.ProductDeviceAlgorithm || c.ProductDeviceKey != approval.ProductDeviceKey || c.Account != approval.Account || !sameStrings(c.Scopes, approval.GrantedScopes) || !expires.After(issued) || issued.After(now) || !expires.After(now) {
		return time.Time{}, time.Time{}, errors.New("gateway challenge does not match the Wallet approval")
	}
	return issued, expires, nil
}

func verifyWalletApprovalSignature(approval WalletAuthorizationResponse) error {
	unsigned := map[string]any{
		"version": approval.Version, "requestDigest": approval.RequestDigest, "nonce": approval.Nonce, "chainId": approval.ChainID,
		"requestingProduct": approval.RequestingProduct, "productClientId": approval.ProductClientID, "bundleId": approval.BundleID,
		"productDeviceAlgorithm": approval.ProductDeviceAlgorithm, "productDeviceKey": approval.ProductDeviceKey, "callback": approval.Callback,
		"account": approval.Account, "accountPublicKey": approval.AccountPublicKey, "grantedScopes": approval.GrantedScopes, "purpose": approval.Purpose,
		"issuedAt": approval.IssuedAt, "expiresAt": approval.ExpiresAt,
	}
	return verifyCompactWalletSignature(approval.Account, approval.AccountPublicKey, approval.WalletSignature, walletApprovalDomain+"\n"+string(mustCanonical(unsigned)))
}

func verifyGatewayDeviceProof(completion GatewayCompletion) error {
	keyBytes, err := base64.RawURLEncoding.DecodeString(completion.Challenge.ProductDeviceKey)
	if err != nil || len(keyBytes) != 33 {
		return errors.New("gateway product device key is invalid")
	}
	x, y := elliptic.UnmarshalCompressed(elliptic.P256(), keyBytes)
	if x == nil || y == nil {
		return errors.New("gateway product device key is invalid")
	}
	signature, err := base64.RawURLEncoding.DecodeString(completion.DeviceSignature)
	if err != nil || len(signature) < 68 || len(signature) > 72 {
		return errors.New("gateway product device signature is invalid")
	}
	digest := sha256.Sum256([]byte(walletGatewayDomain + "\n" + string(mustCanonical(completion.Challenge))))
	if !ecdsa.VerifyASN1(&ecdsa.PublicKey{Curve: elliptic.P256(), X: x, Y: y}, digest[:], signature) {
		return errors.New("gateway product device signature verification failed")
	}
	return nil
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

func validP256DeviceKey(value string) bool {
	if !walletDeviceKeyPattern.MatchString(value) {
		return false
	}
	bytes, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(bytes) != 33 || base64.RawURLEncoding.EncodeToString(bytes) != value {
		return false
	}
	x, y := elliptic.UnmarshalCompressed(elliptic.P256(), bytes)
	return x != nil && y != nil
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

func hmacEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var v byte
	for i := range a {
		v |= a[i] ^ b[i]
	}
	return v == 0
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
