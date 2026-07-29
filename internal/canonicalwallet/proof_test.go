package canonicalwallet

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func TestProductSessionProofExactRequestAndTamper(t *testing.T) {
	now := time.Date(2026, 7, 22, 16, 0, 0, 0, time.UTC)
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	device := base64.RawURLEncoding.EncodeToString(elliptic.MarshalCompressed(elliptic.P256(), privateKey.X, privateKey.Y))
	binding := strings.Repeat("a", 64)
	session := Session{VerifierVersion: "wallet-auth-v1", SessionBinding: binding, ChainID: ChainID, RequestingProduct: "resource-market", ProductClientID: "ynx-resource-market-v1", BundleID: "com.ynxweb4.resource", Callback: "ynxresource://wallet-auth/callback", ProductDeviceAlgorithm: "p256-sha256", ProductDeviceKey: device, DeviceBinding: strings.Repeat("b", 64), Account: "ynx1buyer", Scopes: []string{"account:read", "resource:quote"}, Nonce: strings.Repeat("n", 32), Purpose: "test", RequestDigest: strings.Repeat("c", 64), ApprovalDigest: strings.Repeat("d", 64), IssuedAt: now.Add(-time.Minute), ExpiresAt: now.Add(5 * time.Minute)}
	body := []byte(`{"units":25}`)
	sum := sha256.Sum256(body)
	proof := ProductSessionProof{Version: "1", SessionBinding: binding, ProductClientID: session.ProductClientID, BundleID: session.BundleID, ProductDeviceKey: device, Method: "POST", Path: "/api/authority/intents", BodyDigest: hex.EncodeToString(sum[:]), Nonce: strings.Repeat("z", 32), IssuedAt: now.Add(-time.Second).Format("2006-01-02T15:04:05.000Z"), ExpiresAt: now.Add(30 * time.Second).Format("2006-01-02T15:04:05.000Z")}
	message, _ := productSessionProofSignBytes(proof)
	digest := sha256.Sum256(message)
	signature, _ := ecdsa.SignASN1(rand.Reader, privateKey, digest[:])
	proof.Signature = base64.RawURLEncoding.EncodeToString(signature)
	raw, _ := json.Marshal(proof)
	parsed, err := ParseProductSessionProofHeader(base64.RawURLEncoding.EncodeToString(raw))
	if err != nil {
		t.Fatal(err)
	}
	if digest, err := VerifyProductSessionProof(parsed, session, "POST", "/api/authority/intents", body, now); err != nil || len(digest) != 64 {
		t.Fatalf("verify digest=%q err=%v", digest, err)
	}
	for name, mutate := range map[string]func(ProductSessionProof) ProductSessionProof{
		"path": func(p ProductSessionProof) ProductSessionProof { p.Path = "/api/authority/quote"; return p },
		"body": func(p ProductSessionProof) ProductSessionProof { p.BodyDigest = strings.Repeat("0", 64); return p },
		"device": func(p ProductSessionProof) ProductSessionProof {
			p.ProductDeviceKey = base64.RawURLEncoding.EncodeToString(elliptic.MarshalCompressed(elliptic.P256(), elliptic.P256().Params().Gx, elliptic.P256().Params().Gy))
			return p
		},
		"expiry": func(p ProductSessionProof) ProductSessionProof {
			p.ExpiresAt = now.Format("2006-01-02T15:04:05.000Z")
			return p
		},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := VerifyProductSessionProof(mutate(proof), session, "POST", "/api/authority/intents", body, now); err == nil {
				t.Fatal("tamper accepted")
			}
		})
	}
}

func TestProductSessionProofMatchesCanonicalSDKVector(t *testing.T) {
	raw, err := os.ReadFile("../../apps/resource-market/integration/canonical-wallet-v1-test-vector.json")
	if err != nil {
		t.Fatal(err)
	}
	var vector struct {
		ExpectedSession     Session `json:"expectedSession"`
		ProductSessionProof struct {
			Body  string              `json:"body"`
			Proof ProductSessionProof `json:"proof"`
		} `json:"productSessionProof"`
	}
	if err := json.Unmarshal(raw, &vector); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyProductSessionProof(vector.ProductSessionProof.Proof, vector.ExpectedSession, "POST", "/api/authority/intents", []byte(vector.ProductSessionProof.Body), time.Date(2026, 7, 18, 6, 0, 1, 0, time.UTC)); err != nil {
		t.Fatalf("canonical SDK proof rejected: %v", err)
	}
}
