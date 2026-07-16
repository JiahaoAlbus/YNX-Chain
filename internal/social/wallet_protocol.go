package social

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	secpECDSA "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

const protocolTimeLayout = "2006-01-02T15:04:05.000Z"

var (
	walletNoncePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{32,64}$`)
	hex64Pattern       = regexp.MustCompile(`^[0-9a-f]{64}$`)
	hex128Pattern      = regexp.MustCompile(`^[0-9a-f]{128}$`)
	walletScopes       = []string{"account:read", "profile:link"}
)

func walletRequestValue(r WalletAuthorizationRequest) map[string]any {
	return map[string]any{"version": r.Version, "nonce": r.Nonce, "chainId": r.ChainID, "requestingProduct": r.RequestingProduct, "productClientId": r.ProductClientID, "bundleId": r.BundleID, "productDeviceAlgorithm": r.ProductDeviceAlgorithm, "productDeviceKey": r.ProductDeviceKey, "callback": r.Callback, "scopes": r.Scopes, "purpose": r.Purpose, "issuedAt": r.IssuedAt, "expiresAt": r.ExpiresAt}
}

func walletApprovalValue(a WalletApproval) map[string]any {
	return map[string]any{"version": a.Version, "requestDigest": a.RequestDigest, "nonce": a.Nonce, "chainId": a.ChainID, "requestingProduct": a.RequestingProduct, "productClientId": a.ProductClientID, "bundleId": a.BundleID, "productDeviceAlgorithm": a.ProductDeviceAlgorithm, "productDeviceKey": a.ProductDeviceKey, "callback": a.Callback, "account": a.Account, "accountPublicKey": a.AccountPublicKey, "grantedScopes": a.GrantedScopes, "purpose": a.Purpose, "issuedAt": a.IssuedAt, "expiresAt": a.ExpiresAt}
}

func walletChallengeValue(c ProductSessionChallenge) map[string]any {
	return map[string]any{"version": c.Version, "challenge": c.Challenge, "requestDigest": c.RequestDigest, "productClientId": c.ProductClientID, "bundleId": c.BundleID, "productDeviceAlgorithm": c.ProductDeviceAlgorithm, "productDeviceKey": c.ProductDeviceKey, "account": c.Account, "scopes": c.Scopes, "issuedAt": c.IssuedAt, "expiresAt": c.ExpiresAt}
}

func canonicalJSON(value any) ([]byte, error) {
	var buf bytes.Buffer
	if err := writeCanonicalJSON(&buf, value); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func writeCanonicalJSON(buf *bytes.Buffer, value any) error {
	switch v := value.(type) {
	case nil, string, bool:
		encoded, _ := json.Marshal(v)
		buf.Write(encoded)
		return nil
	case []string:
		buf.WriteByte('[')
		for i, item := range v {
			if i > 0 {
				buf.WriteByte(',')
			}
			encoded, _ := json.Marshal(item)
			buf.Write(encoded)
		}
		buf.WriteByte(']')
		return nil
	case map[string]any:
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		buf.WriteByte('{')
		for i, key := range keys {
			if i > 0 {
				buf.WriteByte(',')
			}
			encoded, _ := json.Marshal(key)
			buf.Write(encoded)
			buf.WriteByte(':')
			if err := writeCanonicalJSON(buf, v[key]); err != nil {
				return err
			}
		}
		buf.WriteByte('}')
		return nil
	default:
		return fmt.Errorf("unsupported canonical JSON value %T", value)
	}
}

func domainDigest(domain string, value map[string]any) ([32]byte, error) {
	canonical, err := canonicalJSON(value)
	if err != nil {
		return [32]byte{}, err
	}
	return sha256.Sum256(append([]byte(domain+"\n"), canonical...)), nil
}

func WalletRequestDigest(r WalletAuthorizationRequest) (string, error) {
	digest, err := domainDigest("YNX_WALLET_AUTH_REQUEST_V1", walletRequestValue(r))
	return hex.EncodeToString(digest[:]), err
}

func WalletApprovalSignBytes(a WalletApproval) ([]byte, error) {
	canonical, err := canonicalJSON(walletApprovalValue(a))
	if err != nil {
		return nil, err
	}
	return append([]byte("YNX_WALLET_AUTH_APPROVAL_V1\n"), canonical...), nil
}

func GatewayChallengeSignBytes(c ProductSessionChallenge) ([]byte, error) {
	canonical, err := canonicalJSON(walletChallengeValue(c))
	if err != nil {
		return nil, err
	}
	return append([]byte("YNX_PRODUCT_SESSION_CHALLENGE_V1\n"), canonical...), nil
}

func parseProtocolTime(value string) (time.Time, error) {
	if len(value) != len(protocolTimeLayout) {
		return time.Time{}, ErrInvalid
	}
	parsed, err := time.Parse(protocolTimeLayout, value)
	if err != nil || parsed.Format(protocolTimeLayout) != value {
		return time.Time{}, ErrInvalid
	}
	return parsed, nil
}

func validProductDeviceKey(value string) bool {
	if len(value) != 44 || strings.Contains(value, "=") {
		return false
	}
	data, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(data) != 33 || base64.RawURLEncoding.EncodeToString(data) != value {
		return false
	}
	x, y := elliptic.UnmarshalCompressed(elliptic.P256(), data)
	return x != nil && y != nil
}

func validateWalletRequest(r WalletAuthorizationRequest, now time.Time) (time.Time, error) {
	if r.Version != "1" || r.ChainID != "ynx_6423-1" || r.RequestingProduct != RequestingProduct || r.ProductClientID != ProductClientID || r.BundleID != BundleID || r.ProductDeviceAlgorithm != ProductDeviceAlgorithm || r.Callback != Callback {
		return time.Time{}, fmt.Errorf("%w: wallet product binding", ErrInvalid)
	}
	if !walletNoncePattern.MatchString(r.Nonce) || !validProductDeviceKey(r.ProductDeviceKey) || len(r.Purpose) < 1 || len(r.Purpose) > 180 || strings.TrimSpace(r.Purpose) != r.Purpose || strings.Join(r.Scopes, "\n") != strings.Join(walletScopes, "\n") {
		return time.Time{}, fmt.Errorf("%w: wallet request fields", ErrInvalid)
	}
	issued, err := parseProtocolTime(r.IssuedAt)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: wallet request issuedAt", ErrInvalid)
	}
	expires, err := parseProtocolTime(r.ExpiresAt)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: wallet request expiresAt", ErrInvalid)
	}
	if issued.After(now.Add(30*time.Second)) || !expires.After(now) || !expires.After(issued) || expires.Sub(issued) > 5*time.Minute {
		return time.Time{}, fmt.Errorf("%w: wallet request lifetime", ErrUnauthorized)
	}
	return expires, nil
}

func verifyWalletApproval(r WalletAuthorizationRequest, a WalletApproval, now time.Time) (time.Time, error) {
	requestExpires, err := validateWalletRequest(r, now)
	if err != nil {
		return time.Time{}, err
	}
	digest, err := WalletRequestDigest(r)
	if err != nil {
		return time.Time{}, err
	}
	if a.Version != "1" || a.RequestDigest != digest || a.Nonce != r.Nonce || a.ChainID != r.ChainID || a.RequestingProduct != r.RequestingProduct || a.ProductClientID != r.ProductClientID || a.BundleID != r.BundleID || a.ProductDeviceAlgorithm != r.ProductDeviceAlgorithm || a.ProductDeviceKey != r.ProductDeviceKey || a.Callback != r.Callback || a.Purpose != r.Purpose || strings.Join(a.GrantedScopes, "\n") != strings.Join(r.Scopes, "\n") {
		return time.Time{}, fmt.Errorf("%w: wallet approval binding", ErrUnauthorized)
	}
	issued, err := parseProtocolTime(a.IssuedAt)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: wallet approval issuedAt", ErrInvalid)
	}
	expires, err := parseProtocolTime(a.ExpiresAt)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: wallet approval expiresAt", ErrInvalid)
	}
	if issued.After(now.Add(30*time.Second)) || !expires.After(now) || !expires.After(issued) || expires.After(requestExpires) || expires.Sub(issued) > 5*time.Minute {
		return time.Time{}, fmt.Errorf("%w: wallet approval lifetime", ErrUnauthorized)
	}
	if !hex64Pattern.MatchString(strings.TrimPrefix(a.AccountPublicKey, "02")) && !hex64Pattern.MatchString(strings.TrimPrefix(a.AccountPublicKey, "03")) {
		return time.Time{}, fmt.Errorf("%w: wallet public key", ErrInvalid)
	}
	pubBytes, err := hex.DecodeString(a.AccountPublicKey)
	if err != nil || len(pubBytes) != 33 {
		return time.Time{}, fmt.Errorf("%w: wallet public key", ErrInvalid)
	}
	pub, err := secp256k1.ParsePubKey(pubBytes)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: wallet public key", ErrInvalid)
	}
	native, err := consensus.NativeAddress(pub.SerializeCompressed())
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: wallet account", ErrInvalid)
	}
	account, err := accountaddress.Encode(native)
	if err != nil || account != a.Account {
		return time.Time{}, fmt.Errorf("%w: wallet account binding", ErrUnauthorized)
	}
	if !hex128Pattern.MatchString(a.WalletSignature) {
		return time.Time{}, fmt.Errorf("%w: wallet signature", ErrInvalid)
	}
	sigBytes, _ := hex.DecodeString(a.WalletSignature)
	var rr, ss secp256k1.ModNScalar
	if rr.SetByteSlice(sigBytes[:32]) || ss.SetByteSlice(sigBytes[32:]) || rr.IsZero() || ss.IsZero() || ss.IsOverHalfOrder() {
		return time.Time{}, fmt.Errorf("%w: wallet signature", ErrUnauthorized)
	}
	signBytes, _ := WalletApprovalSignBytes(a)
	signDigest := sha256.Sum256(signBytes)
	if !secpECDSA.NewSignature(&rr, &ss).Verify(signDigest[:], pub) {
		return time.Time{}, fmt.Errorf("%w: wallet signature", ErrUnauthorized)
	}
	return expires, nil
}

func verifyProductDeviceSignature(c ProductSessionChallenge, signature string) bool {
	key, err := base64.RawURLEncoding.DecodeString(c.ProductDeviceKey)
	if err != nil {
		return false
	}
	x, y := elliptic.UnmarshalCompressed(elliptic.P256(), key)
	if x == nil {
		return false
	}
	sig, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil || len(sig) < 68 || len(sig) > 72 {
		return false
	}
	bytes, err := GatewayChallengeSignBytes(c)
	if err != nil {
		return false
	}
	digest := sha256.Sum256(bytes)
	return ecdsa.VerifyASN1(&ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).Set(x), Y: new(big.Int).Set(y)}, digest[:], sig)
}
