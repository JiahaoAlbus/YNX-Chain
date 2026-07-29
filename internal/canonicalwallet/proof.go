package canonicalwallet

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"time"
)

const ProductSessionProofHeader = "X-YNX-Product-Session-Proof"

var (
	proofDigestPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
	proofNoncePattern  = regexp.MustCompile(`^[A-Za-z0-9_-]{32,64}$`)
	proofPathPattern   = regexp.MustCompile(`^/[A-Za-z0-9._~!$&'()*+,;=:@/-]{1,255}$`)
)

type ProductSessionProof struct {
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

// Alphabetical declaration order matches canonicalJSON's sorted object keys.
type productSessionProofUnsigned struct {
	BodyDigest       string `json:"bodyDigest"`
	BundleID         string `json:"bundleId"`
	ExpiresAt        string `json:"expiresAt"`
	IssuedAt         string `json:"issuedAt"`
	Method           string `json:"method"`
	Nonce            string `json:"nonce"`
	Path             string `json:"path"`
	ProductClientID  string `json:"productClientId"`
	ProductDeviceKey string `json:"productDeviceKey"`
	SessionBinding   string `json:"sessionBinding"`
	Version          string `json:"version"`
}

func ParseProductSessionProofHeader(value string) (ProductSessionProof, error) {
	var proof ProductSessionProof
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(raw) == 0 || len(raw) > 4096 {
		return proof, errors.New("canonical Product Session proof header is invalid")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&proof); err != nil {
		return proof, errors.New("canonical Product Session proof schema is invalid")
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		return proof, errors.New("canonical Product Session proof must be one exact object")
	}
	if err := validateProofShape(proof); err != nil {
		return proof, err
	}
	return proof, nil
}

func SignProductSessionProof(proof ProductSessionProof, privateKey *ecdsa.PrivateKey) (ProductSessionProof, error) {
	if privateKey == nil || privateKey.Curve != elliptic.P256() {
		return proof, errors.New("canonical Product Session proof signing key is invalid")
	}
	proof.Signature = base64.RawURLEncoding.EncodeToString(make([]byte, 68))
	if err := validateProofShape(proof); err != nil {
		return proof, err
	}
	message, err := productSessionProofSignBytes(proof)
	if err != nil {
		return proof, err
	}
	digest := sha256.Sum256(message)
	signature, err := ecdsa.SignASN1(rand.Reader, privateKey, digest[:])
	if err != nil {
		return proof, err
	}
	proof.Signature = base64.RawURLEncoding.EncodeToString(signature)
	return proof, nil
}

func EncodeProductSessionProofHeader(proof ProductSessionProof) (string, error) {
	if err := validateProofShape(proof); err != nil {
		return "", err
	}
	raw, err := json.Marshal(proof)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func VerifyProductSessionProof(proof ProductSessionProof, session Session, method, path string, body []byte, now time.Time) (string, error) {
	if err := validateProofShape(proof); err != nil {
		return "", err
	}
	if err := AssertActive(session, proof.SessionBinding, proof.ProductDeviceKey, []string{"account:read"}, now); err != nil {
		return "", err
	}
	bodySum := sha256.Sum256(body)
	if proof.ProductClientID != session.ProductClientID || proof.BundleID != session.BundleID || proof.Method != method || proof.Path != path || proof.BodyDigest != hex.EncodeToString(bodySum[:]) {
		return "", errors.New("canonical Product Session proof request binding mismatch")
	}
	issued, _ := time.Parse("2006-01-02T15:04:05.000Z", proof.IssuedAt)
	expires, _ := time.Parse("2006-01-02T15:04:05.000Z", proof.ExpiresAt)
	if issued.Before(session.IssuedAt) || issued.After(now) || !expires.After(now) || expires.After(session.ExpiresAt) || !expires.After(issued) || expires.Sub(issued) > time.Minute {
		return "", errors.New("canonical Product Session proof lifetime is invalid")
	}
	key, err := base64.RawURLEncoding.DecodeString(proof.ProductDeviceKey)
	if err != nil || len(key) != 33 {
		return "", errors.New("canonical Product Session proof device key is invalid")
	}
	x, y := elliptic.UnmarshalCompressed(elliptic.P256(), key)
	if x == nil || y == nil {
		return "", errors.New("canonical Product Session proof device key is invalid")
	}
	signature, err := base64.RawURLEncoding.DecodeString(proof.Signature)
	if err != nil || len(signature) < 68 || len(signature) > 72 {
		return "", errors.New("canonical Product Session proof signature is invalid")
	}
	message, err := productSessionProofSignBytes(proof)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(message)
	if !ecdsa.VerifyASN1(&ecdsa.PublicKey{Curve: elliptic.P256(), X: x, Y: y}, digest[:], signature) {
		return "", errors.New("canonical Product Session proof signature is invalid")
	}
	full, _ := json.Marshal(proof)
	proofDigest := sha256.Sum256(append([]byte("YNX_PRODUCT_SESSION_HTTP_PROOF_DIGEST_V1\n"), full...))
	return hex.EncodeToString(proofDigest[:]), nil
}

func productSessionProofSignBytes(proof ProductSessionProof) ([]byte, error) {
	u := productSessionProofUnsigned{BodyDigest: proof.BodyDigest, BundleID: proof.BundleID, ExpiresAt: proof.ExpiresAt, IssuedAt: proof.IssuedAt, Method: proof.Method, Nonce: proof.Nonce, Path: proof.Path, ProductClientID: proof.ProductClientID, ProductDeviceKey: proof.ProductDeviceKey, SessionBinding: proof.SessionBinding, Version: proof.Version}
	raw, err := json.Marshal(u)
	if err != nil {
		return nil, err
	}
	return append([]byte("YNX_PRODUCT_SESSION_HTTP_PROOF_V1\n"), raw...), nil
}

func validateProofShape(proof ProductSessionProof) error {
	if proof.Version != "1" || !proofDigestPattern.MatchString(proof.SessionBinding) || !proofDigestPattern.MatchString(proof.BodyDigest) || !proofNoncePattern.MatchString(proof.Nonce) || !proofPathPattern.MatchString(proof.Path) || proof.Path[len(proof.Path)-1] == '/' || bytes.Contains([]byte(proof.Path), []byte("//")) {
		return errors.New("canonical Product Session proof fields are invalid")
	}
	if proof.Method != "GET" && proof.Method != "POST" && proof.Method != "PUT" && proof.Method != "PATCH" && proof.Method != "DELETE" {
		return errors.New("canonical Product Session proof method is invalid")
	}
	issued, issuedErr := time.Parse("2006-01-02T15:04:05.000Z", proof.IssuedAt)
	expires, expiresErr := time.Parse("2006-01-02T15:04:05.000Z", proof.ExpiresAt)
	if proof.ProductClientID == "" || proof.BundleID == "" || len(proof.ProductDeviceKey) != 44 || issuedErr != nil || expiresErr != nil || issued.Format("2006-01-02T15:04:05.000Z") != proof.IssuedAt || expires.Format("2006-01-02T15:04:05.000Z") != proof.ExpiresAt {
		return fmt.Errorf("canonical Product Session proof identity or time is invalid")
	}
	if _, err := base64.RawURLEncoding.DecodeString(proof.Signature); err != nil {
		return errors.New("canonical Product Session proof signature encoding is invalid")
	}
	return nil
}
