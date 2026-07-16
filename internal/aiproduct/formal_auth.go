package aiproduct

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
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
	FormalWalletVersion   = "1"
	FormalProductClientID = "ynx-ai-v1"
	FormalBundleID        = "com.ynxweb4.ai"
	FormalCallback        = "ynxai://wallet-auth/callback"
	FormalDeviceAlgorithm = "p256-sha256"
)

var FormalScopes = []string{"ai:actions", "ai:attachments", "ai:conversations", "ai:data-control", "ai:generate", "ai:permissions"}

type FormalAuthorizationRequest struct {
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

type FormalAuthorizationResponse struct {
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

type FormalGatewayChallenge struct {
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

type FormalWalletRequestRecord struct {
	Request       FormalAuthorizationRequest `json:"request"`
	RequestDigest string                     `json:"requestDigest"`
	Status        string                     `json:"status"`
	ApprovedAt    time.Time                  `json:"approvedAt,omitempty"`
}

type FormalGatewayChallengeRecord struct {
	Challenge  FormalGatewayChallenge `json:"challenge"`
	Status     string                 `json:"status"`
	CreatedAt  time.Time              `json:"createdAt"`
	ConsumedAt time.Time              `json:"consumedAt,omitempty"`
}

type FormalRequestInput struct {
	ProductDeviceKey string `json:"productDeviceKey"`
	PurposeLanguage  string `json:"purposeLanguage,omitempty"`
}
type FormalRequestOutput struct {
	Request       FormalAuthorizationRequest `json:"request"`
	RequestDigest string                     `json:"requestDigest"`
	WalletURL     string                     `json:"walletUrl"`
}
type FormalApprovalInput struct {
	Response FormalAuthorizationResponse `json:"response"`
}
type FormalApprovalOutput struct {
	Challenge FormalGatewayChallenge `json:"challenge"`
	SignBytes string                 `json:"signBytes"`
	ExpiresAt string                 `json:"expiresAt"`
}
type FormalCompletionInput struct {
	Challenge       FormalGatewayChallenge `json:"challenge"`
	DeviceSignature string                 `json:"deviceSignature"`
}

func (s *Store) CreateFormalWalletRequest(input FormalRequestInput) (FormalRequestOutput, error) {
	if err := validateP256Compressed(input.ProductDeviceKey); err != nil {
		return FormalRequestOutput{}, err
	}
	now := s.now().UTC().Truncate(time.Millisecond)
	nonceBytes := make([]byte, 32)
	if _, err := rand.Read(nonceBytes); err != nil {
		return FormalRequestOutput{}, err
	}
	purpose := "Sign in to YNX AI for conversations, attachments, generation, permissions, actions, and data controls. No signing or transfer authority."
	request := FormalAuthorizationRequest{Version: FormalWalletVersion, Nonce: base64.RawURLEncoding.EncodeToString(nonceBytes), ChainID: ChainNetwork, RequestingProduct: ProductID, ProductClientID: FormalProductClientID, BundleID: FormalBundleID, ProductDeviceAlgorithm: FormalDeviceAlgorithm, ProductDeviceKey: input.ProductDeviceKey, Callback: FormalCallback, Scopes: append([]string(nil), FormalScopes...), Purpose: purpose, IssuedAt: formatMillis(now), ExpiresAt: formatMillis(now.Add(5 * time.Minute))}
	digest, err := formalRequestDigest(request)
	if err != nil {
		return FormalRequestOutput{}, err
	}
	raw, err := canonicalJSON(request)
	if err != nil {
		return FormalRequestOutput{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.purgeFormalAuthLocked(now)
	s.state.FormalRequests[digest] = FormalWalletRequestRecord{Request: request, RequestDigest: digest, Status: "pending"}
	s.auditLocked("", "formal_wallet_request_created", digest, "ynx-ai-v1 exact callback, P-256 device key, sorted scopes, five-minute expiry")
	if err := s.saveLocked(); err != nil {
		return FormalRequestOutput{}, err
	}
	return FormalRequestOutput{Request: request, RequestDigest: digest, WalletURL: "ynxwallet://authorize?request=" + base64.RawURLEncoding.EncodeToString([]byte(raw))}, nil
}

func (s *Store) ApproveFormalWallet(input FormalApprovalInput) (FormalApprovalOutput, error) {
	response := input.Response
	if err := validateFormalResponseShape(response); err != nil {
		return FormalApprovalOutput{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now().UTC().Truncate(time.Millisecond)
	s.purgeFormalAuthLocked(now)
	record, ok := s.state.FormalRequests[response.RequestDigest]
	if !ok || record.Status != "pending" {
		return FormalApprovalOutput{}, errors.New("Wallet approval request is unknown, expired, or already consumed")
	}
	if err := verifyFormalApproval(response, record.Request, now); err != nil {
		return FormalApprovalOutput{}, err
	}
	expires, _ := time.Parse(time.RFC3339Nano, response.ExpiresAt)
	challengeExpiry := now.Add(3 * time.Minute)
	if challengeExpiry.After(expires) {
		challengeExpiry = expires
	}
	challengeBytes := make([]byte, 24)
	if _, err := rand.Read(challengeBytes); err != nil {
		return FormalApprovalOutput{}, err
	}
	challenge := FormalGatewayChallenge{Version: "1", Challenge: base64.RawURLEncoding.EncodeToString(challengeBytes), RequestDigest: response.RequestDigest, ProductClientID: response.ProductClientID, BundleID: response.BundleID, ProductDeviceAlgorithm: response.ProductDeviceAlgorithm, ProductDeviceKey: response.ProductDeviceKey, Account: response.Account, Scopes: append([]string(nil), response.GrantedScopes...), IssuedAt: formatMillis(now), ExpiresAt: formatMillis(challengeExpiry)}
	record.Status = "approved_challenge_issued"
	record.ApprovedAt = now
	s.state.FormalRequests[response.RequestDigest] = record
	s.state.FormalChallenges[challenge.Challenge] = FormalGatewayChallengeRecord{Challenge: challenge, Status: "pending", CreatedAt: now}
	s.auditLocked(response.Account, "formal_wallet_approval_verified", response.RequestDigest, "Wallet signature, account, callback, device and exact Gateway scopes verified")
	if err := s.saveLocked(); err != nil {
		return FormalApprovalOutput{}, err
	}
	signBytes, err := formalGatewaySignBytes(challenge)
	if err != nil {
		return FormalApprovalOutput{}, err
	}
	return FormalApprovalOutput{Challenge: challenge, SignBytes: base64.RawStdEncoding.EncodeToString([]byte(signBytes)), ExpiresAt: challenge.ExpiresAt}, nil
}

func (s *Store) CompleteFormalWallet(input FormalCompletionInput) (SessionOutput, error) {
	if strings.TrimSpace(input.DeviceSignature) == "" {
		return SessionOutput{}, errors.New("product-device signature is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now().UTC().Truncate(time.Millisecond)
	s.purgeFormalAuthLocked(now)
	record, ok := s.state.FormalChallenges[input.Challenge.Challenge]
	if !ok || record.Status != "pending" {
		return SessionOutput{}, errors.New("Gateway challenge is unknown, expired, or already consumed")
	}
	if !formalChallengeEqual(record.Challenge, input.Challenge) {
		return SessionOutput{}, errors.New("Gateway challenge binding was tampered")
	}
	expires, err := time.Parse(time.RFC3339Nano, input.Challenge.ExpiresAt)
	if err != nil || !now.Before(expires) {
		return SessionOutput{}, errors.New("Gateway challenge expired")
	}
	if err := verifyFormalDeviceSignature(input.Challenge, input.DeviceSignature); err != nil {
		return SessionOutput{}, err
	}
	canonical, err := canonicalJSON(input.Challenge)
	if err != nil {
		return SessionOutput{}, err
	}
	binding := sha256.Sum256([]byte(canonical))
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return SessionOutput{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	tokenHash := sha256.Sum256([]byte(token))
	session := ProductSession{ID: randomID("session"), TokenHash: hex.EncodeToString(tokenHash[:]), Account: input.Challenge.Account, DeviceID: input.Challenge.ProductDeviceKey, ProductClientID: input.Challenge.ProductClientID, BundleID: input.Challenge.BundleID, SessionBinding: hex.EncodeToString(binding[:]), Scopes: append([]string(nil), input.Challenge.Scopes...), IssuedAt: now, ExpiresAt: expires, Status: "active"}
	record.Status = "consumed"
	record.ConsumedAt = now
	s.state.FormalChallenges[input.Challenge.Challenge] = record
	s.state.Sessions[session.ID] = session
	s.auditLocked(session.Account, "formal_product_session_created", session.ID, "Wallet approval plus P-256 product-device challenge completed; exact Gateway scopes bound")
	if err := s.saveLocked(); err != nil {
		return SessionOutput{}, err
	}
	return SessionOutput{SessionID: session.ID, Token: token, Account: session.Account, DeviceID: session.DeviceID, Scopes: session.Scopes, ExpiresAt: session.ExpiresAt}, nil
}

func validateFormalResponseShape(r FormalAuthorizationResponse) error {
	if r.Version != "1" || r.ChainID != ChainNetwork || r.RequestingProduct != ProductID || r.ProductClientID != FormalProductClientID || r.BundleID != FormalBundleID || r.ProductDeviceAlgorithm != FormalDeviceAlgorithm || r.Callback != FormalCallback {
		return errors.New("Wallet approval product, network, callback, or algorithm mismatch")
	}
	if err := validateP256Compressed(r.ProductDeviceKey); err != nil {
		return err
	}
	if len(r.GrantedScopes) != len(FormalScopes) || strings.Join(r.GrantedScopes, "\n") != strings.Join(FormalScopes, "\n") {
		return errors.New("Wallet approval scopes do not exactly match YNX AI Gateway scopes")
	}
	if _, err := hex.DecodeString(r.AccountPublicKey); err != nil {
		return errors.New("Wallet account public key is invalid")
	}
	if len(r.WalletSignature) != 128 {
		return errors.New("Wallet signature must be 64-byte compact hex")
	}
	return nil
}
func verifyFormalApproval(response FormalAuthorizationResponse, request FormalAuthorizationRequest, now time.Time) error {
	digest, err := formalRequestDigest(request)
	if err != nil {
		return err
	}
	if digest != response.RequestDigest {
		return errors.New("Wallet approval request digest mismatch")
	}
	if response.Nonce != request.Nonce || response.ChainID != request.ChainID || response.RequestingProduct != request.RequestingProduct || response.ProductClientID != request.ProductClientID || response.BundleID != request.BundleID || response.ProductDeviceAlgorithm != request.ProductDeviceAlgorithm || response.ProductDeviceKey != request.ProductDeviceKey || response.Callback != request.Callback || response.Purpose != request.Purpose || strings.Join(response.GrantedScopes, "\n") != strings.Join(request.Scopes, "\n") {
		return errors.New("Wallet approval does not match the exact product request")
	}
	requestExpiry, err := time.Parse(time.RFC3339Nano, request.ExpiresAt)
	if err != nil || !now.Before(requestExpiry) {
		return errors.New("Wallet authorization request expired")
	}
	requestIssued, requestIssuedErr := time.Parse(time.RFC3339Nano, request.IssuedAt)
	approvalIssued, approvalIssuedErr := time.Parse(time.RFC3339Nano, response.IssuedAt)
	if requestIssuedErr != nil || approvalIssuedErr != nil || approvalIssued.Before(requestIssued) || approvalIssued.After(now) {
		return errors.New("Wallet approval issue time is invalid")
	}
	approvalExpiry, err := time.Parse(time.RFC3339Nano, response.ExpiresAt)
	if err != nil || !now.Before(approvalExpiry) || approvalExpiry.After(requestExpiry) {
		return errors.New("Wallet approval expiry is invalid")
	}
	unsigned := response
	unsigned.WalletSignature = ""
	payload := map[string]any{}
	raw, _ := json.Marshal(unsigned)
	_ = json.Unmarshal(raw, &payload)
	delete(payload, "walletSignature")
	canonical, err := canonicalJSON(payload)
	if err != nil {
		return err
	}
	digestBytes := sha256.Sum256([]byte("YNX_WALLET_AUTH_APPROVAL_V1\n" + canonical))
	pubBytes, err := hex.DecodeString(response.AccountPublicKey)
	if err != nil || len(pubBytes) != 33 {
		return errors.New("Wallet account public key is invalid")
	}
	derived, err := consensus.NativeAddress(pubBytes)
	if err != nil {
		return errors.New("Wallet account public key is invalid")
	}
	native, err := accountaddress.Encode(derived)
	if err != nil || native != response.Account {
		return errors.New("Wallet account does not match its public key")
	}
	sigBytes, err := hex.DecodeString(response.WalletSignature)
	if err != nil || len(sigBytes) != 64 {
		return errors.New("Wallet signature is invalid")
	}
	var rScalar, sScalar secp256k1.ModNScalar
	if rScalar.SetByteSlice(sigBytes[:32]) || sScalar.SetByteSlice(sigBytes[32:]) || sScalar.IsOverHalfOrder() {
		return errors.New("Wallet signature is non-canonical")
	}
	pub, err := secp256k1.ParsePubKey(pubBytes)
	if err != nil || !secpECDSA.NewSignature(&rScalar, &sScalar).Verify(digestBytes[:], pub) {
		return errors.New("Wallet approval signature is invalid")
	}
	return nil
}
func verifyFormalDeviceSignature(challenge FormalGatewayChallenge, encoded string) error {
	keyBytes, err := base64.RawURLEncoding.DecodeString(challenge.ProductDeviceKey)
	if err != nil || len(keyBytes) != 33 {
		return errors.New("product device key is invalid")
	}
	x, y := elliptic.UnmarshalCompressed(elliptic.P256(), keyBytes)
	if x == nil || y == nil {
		return errors.New("product device key is not a valid P-256 point")
	}
	sig, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(sig) < 68 || len(sig) > 72 {
		return errors.New("product-device signature is invalid")
	}
	signBytes, err := formalGatewaySignBytes(challenge)
	if err != nil {
		return err
	}
	digest := sha256.Sum256([]byte(signBytes))
	if !ecdsa.VerifyASN1(&ecdsa.PublicKey{Curve: elliptic.P256(), X: x, Y: y}, digest[:], sig) {
		return errors.New("product-device signature is invalid")
	}
	return nil
}
func validateP256Compressed(encoded string) error {
	if len(encoded) != 44 || strings.Contains(encoded, "=") {
		return errors.New("productDeviceKey must be canonical unpadded base64url compressed P-256")
	}
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(raw) != 33 || raw[0] != 2 && raw[0] != 3 {
		return errors.New("productDeviceKey must be canonical unpadded base64url compressed P-256")
	}
	x, y := elliptic.UnmarshalCompressed(elliptic.P256(), raw)
	if x == nil || y == nil || base64.RawURLEncoding.EncodeToString(elliptic.MarshalCompressed(elliptic.P256(), x, y)) != encoded {
		return errors.New("productDeviceKey is not a valid canonical P-256 point")
	}
	return nil
}
func formalRequestDigest(request FormalAuthorizationRequest) (string, error) {
	canonical, err := canonicalJSON(request)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte("YNX_WALLET_AUTH_REQUEST_V1\n" + canonical))
	return hex.EncodeToString(sum[:]), nil
}
func formalGatewaySignBytes(challenge FormalGatewayChallenge) (string, error) {
	canonical, err := canonicalJSON(challenge)
	if err != nil {
		return "", err
	}
	return "YNX_PRODUCT_SESSION_CHALLENGE_V1\n" + canonical, nil
}
func formalChallengeEqual(a, b FormalGatewayChallenge) bool {
	ca, ea := canonicalJSON(a)
	cb, eb := canonicalJSON(b)
	return ea == nil && eb == nil && ca == cb
}
func canonicalJSON(value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	var decoded any
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&decoded); err != nil {
		return "", err
	}
	return canonicalValue(decoded)
}
func canonicalValue(value any) (string, error) {
	switch v := value.(type) {
	case nil:
		return "null", nil
	case string:
		raw, _ := json.Marshal(v)
		return string(raw), nil
	case bool:
		if v {
			return "true", nil
		}
		return "false", nil
	case json.Number:
		if strings.ContainsAny(string(v), ".eE") {
			return "", errors.New("canonical protocol numbers must be integers")
		}
		if _, err := strconv.ParseInt(string(v), 10, 64); err != nil {
			return "", err
		}
		return string(v), nil
	case []any:
		parts := make([]string, len(v))
		for i, item := range v {
			part, err := canonicalValue(item)
			if err != nil {
				return "", err
			}
			parts[i] = part
		}
		return "[" + strings.Join(parts, ",") + "]", nil
	case map[string]any:
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			part, err := canonicalValue(v[key])
			if err != nil {
				return "", err
			}
			name, _ := json.Marshal(key)
			parts = append(parts, string(name)+":"+part)
		}
		return "{" + strings.Join(parts, ",") + "}", nil
	default:
		return "", fmt.Errorf("unsupported canonical JSON type %T", value)
	}
}
func (s *Store) purgeFormalAuthLocked(now time.Time) {
	for id, record := range s.state.FormalRequests {
		expiry, err := time.Parse(time.RFC3339Nano, record.Request.ExpiresAt)
		if err != nil || expiry.Add(24*time.Hour).Before(now) {
			delete(s.state.FormalRequests, id)
		}
	}
	for id, record := range s.state.FormalChallenges {
		expiry, err := time.Parse(time.RFC3339Nano, record.Challenge.ExpiresAt)
		if err != nil || expiry.Add(24*time.Hour).Before(now) {
			delete(s.state.FormalChallenges, id)
		}
	}
}

func formatMillis(value time.Time) string { return value.UTC().Format("2006-01-02T15:04:05.000Z") }
