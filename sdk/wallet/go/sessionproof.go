// Package wallet implements the frozen, product-scoped YNX Wallet HTTP proof
// consumed by desktop and CLI clients. It does not define Wallet/Auth protocol.
package wallet

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
	"math/big"
	"regexp"
	"sort"
	"strings"
	"time"
)

const proofDomain = "YNX_PRODUCT_SESSION_HTTP_PROOF_V1"

var (
	digestPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
	noncePattern  = regexp.MustCompile(`^[A-Za-z0-9_-]{32,64}$`)
	clientPattern = regexp.MustCompile(`^[a-z][a-z0-9._-]{2,63}$`)
	bundlePattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9.-]{2,127}$`)
	pathPattern   = regexp.MustCompile(`^/[A-Za-z0-9._~!$&'()*+,;=:@/-]{1,255}$`)
)

type Session struct {
	SessionBinding   string `json:"sessionBinding"`
	ProductClientID  string `json:"productClientId"`
	BundleID         string `json:"bundleId"`
	ProductDeviceKey string `json:"productDeviceKey"`
}

type Proof struct {
	Version          string `json:"version"`
	SessionBinding   string `json:"sessionBinding"`
	ProductClientID  string `json:"productClientId"`
	BundleID         string `json:"bundleId"`
	ProductDeviceKey string `json:"productDeviceKey"`
	Method           string `json:"method"`
	Path             string `json:"path"`
	BodyDigest       string `json:"bodyDigest"`
	Nonce            string `json:"nonce"`
	IssuedAt         string `json:"issuedAt"`
	ExpiresAt        string `json:"expiresAt"`
	Signature        string `json:"signature"`
}

func BodyDigest(body []byte) string { sum := sha256.Sum256(body); return hex.EncodeToString(sum[:]) }

func GenerateDeviceIdentity() (*ecdsa.PrivateKey, string, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, "", fmt.Errorf("generate P-256 key: %w", err)
	}
	return key, base64.RawURLEncoding.EncodeToString(elliptic.MarshalCompressed(elliptic.P256(), key.X, key.Y)), nil
}

func SignProof(session Session, input Proof, key *ecdsa.PrivateKey) (Proof, error) {
	if key == nil {
		return Proof{}, errors.New("product device key is required")
	}
	input.Version, input.SessionBinding, input.ProductClientID, input.BundleID = "1", session.SessionBinding, session.ProductClientID, session.BundleID
	input.ProductDeviceKey, input.Signature = session.ProductDeviceKey, ""
	if err := validateUnsigned(input); err != nil {
		return Proof{}, err
	}
	publicKey := base64.RawURLEncoding.EncodeToString(elliptic.MarshalCompressed(elliptic.P256(), key.X, key.Y))
	if publicKey != session.ProductDeviceKey {
		return Proof{}, errors.New("DEVICE_MISMATCH: proof key does not match session device")
	}
	digest := sha256.Sum256([]byte(SignBytes(input)))
	signature, err := ecdsa.SignASN1(rand.Reader, key, digest[:])
	if err != nil {
		return Proof{}, fmt.Errorf("sign proof: %w", err)
	}
	input.Signature = base64.RawURLEncoding.EncodeToString(signature)
	return input, nil
}

func VerifyProof(proof Proof, session Session, method, path string, body []byte, at time.Time) error {
	if err := validateUnsigned(proof); err != nil {
		return err
	}
	if proof.SessionBinding != session.SessionBinding || proof.ProductClientID != session.ProductClientID || proof.BundleID != session.BundleID || proof.ProductDeviceKey != session.ProductDeviceKey {
		return errors.New("SESSION_BINDING_MISMATCH")
	}
	if proof.Method != method || proof.Path != path || proof.BodyDigest != BodyDigest(body) {
		return errors.New("HTTP_BINDING_MISMATCH")
	}
	issued, _ := time.Parse(time.RFC3339Nano, proof.IssuedAt)
	expires, _ := time.Parse(time.RFC3339Nano, proof.ExpiresAt)
	if issued.After(at) {
		return errors.New("ISSUED_IN_FUTURE")
	}
	if !expires.After(at) {
		return errors.New("EXPIRED")
	}
	publicBytes, err := base64.RawURLEncoding.DecodeString(proof.ProductDeviceKey)
	if err != nil {
		return errors.New("INVALID_DEVICE_KEY")
	}
	x, y := elliptic.UnmarshalCompressed(elliptic.P256(), publicBytes)
	if x == nil {
		return errors.New("INVALID_DEVICE_KEY")
	}
	signature, err := base64.RawURLEncoding.DecodeString(proof.Signature)
	if err != nil {
		return errors.New("INVALID_DEVICE_PROOF")
	}
	digest := sha256.Sum256([]byte(SignBytes(proof)))
	if !ecdsa.VerifyASN1(&ecdsa.PublicKey{Curve: elliptic.P256(), X: x, Y: y}, digest[:], signature) {
		return errors.New("INVALID_DEVICE_PROOF")
	}
	return nil
}

func SignBytes(proof Proof) string {
	value := map[string]string{"version": proof.Version, "sessionBinding": proof.SessionBinding, "productClientId": proof.ProductClientID, "bundleId": proof.BundleID, "productDeviceKey": proof.ProductDeviceKey, "method": proof.Method, "path": proof.Path, "bodyDigest": proof.BodyDigest, "nonce": proof.Nonce, "issuedAt": proof.IssuedAt, "expiresAt": proof.ExpiresAt}
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		encodedKey, _ := json.Marshal(key)
		encodedValue, _ := json.Marshal(value[key])
		parts = append(parts, string(encodedKey)+":"+string(encodedValue))
	}
	return proofDomain + "\n{" + strings.Join(parts, ",") + "}"
}

func validateUnsigned(proof Proof) error {
	if proof.Version != "1" || !digestPattern.MatchString(proof.SessionBinding) || !digestPattern.MatchString(proof.BodyDigest) || !clientPattern.MatchString(proof.ProductClientID) || !bundlePattern.MatchString(proof.BundleID) || !noncePattern.MatchString(proof.Nonce) {
		return errors.New("INVALID_FIELD")
	}
	if proof.Method != "DELETE" && proof.Method != "GET" && proof.Method != "PATCH" && proof.Method != "POST" && proof.Method != "PUT" {
		return errors.New("INVALID_FIELD: method")
	}
	if !pathPattern.MatchString(proof.Path) || strings.Contains(proof.Path, "//") || strings.HasSuffix(proof.Path, "/") || strings.ContainsAny(proof.Path, "?#%") {
		return errors.New("INVALID_PATH")
	}
	key, err := base64.RawURLEncoding.DecodeString(proof.ProductDeviceKey)
	if err != nil || len(key) != 33 {
		return errors.New("INVALID_DEVICE_KEY")
	}
	if x, _ := elliptic.UnmarshalCompressed(elliptic.P256(), key); x == nil {
		return errors.New("INVALID_DEVICE_KEY")
	}
	issued, err := time.Parse("2006-01-02T15:04:05.000Z", proof.IssuedAt)
	if err != nil {
		return errors.New("INVALID_TIME")
	}
	expires, err := time.Parse("2006-01-02T15:04:05.000Z", proof.ExpiresAt)
	if err != nil || !expires.After(issued) || expires.Sub(issued) > time.Minute {
		return errors.New("INVALID_EXPIRY")
	}
	return nil
}

func ParseVector(data []byte) (Session, Proof, string, string, []byte, string, error) {
	var raw struct {
		Session  Session                                   `json:"session"`
		Input    struct{ Method, Path, BodyDigest string } `json:"input"`
		Proof    Proof                                     `json:"proof"`
		Expected struct {
			SignBytes string `json:"signBytes"`
		} `json:"expected"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return Session{}, Proof{}, "", "", nil, "", err
	}
	if raw.Input.BodyDigest != BodyDigest([]byte("{}")) {
		return Session{}, Proof{}, "", "", nil, "", errors.New("vector body digest does not bind canonical empty object")
	}
	return raw.Session, raw.Proof, raw.Input.Method, raw.Input.Path, []byte("{}"), raw.Expected.SignBytes, nil
}

func scalarFromBytes(value []byte) *big.Int { return new(big.Int).SetBytes(value) }
