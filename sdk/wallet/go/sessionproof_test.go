package wallet

import (
	"os"
	"testing"
	"time"
)

func TestFrozenVectorAndTamperRejection(t *testing.T) {
	data, err := os.ReadFile("../../../packages/wallet-auth/testdata/product-session-http-proof-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	session, proof, method, path, body, expectedSignBytes, err := ParseVector(data)
	if err != nil {
		t.Fatal(err)
	}
	if actual := SignBytes(proof); actual != expectedSignBytes {
		t.Fatalf("sign bytes mismatch\n%s", actual)
	}
	if err := VerifyProof(proof, session, method, path, body, time.Date(2026, 7, 15, 12, 0, 10, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	if err := VerifyProof(proof, session, method, path+"-tampered", body, time.Date(2026, 7, 15, 12, 0, 10, 0, time.UTC)); err == nil {
		t.Fatal("tampered path was accepted")
	}
}

func TestGeneratedProofAndWrongDevice(t *testing.T) {
	key, public, err := GenerateDeviceIdentity()
	if err != nil {
		t.Fatal(err)
	}
	session := Session{SessionBinding: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ProductClientID: "ynx-cli-v1", BundleID: "com.ynxweb4.cli", ProductDeviceKey: public}
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	proof, err := SignProof(session, Proof{Method: "POST", Path: "/v1/wallet/sessions/introspect", BodyDigest: BodyDigest([]byte("{}")), Nonce: "proof_nonce_abcdefghijklmnopqrstu", IssuedAt: now.Format("2006-01-02T15:04:05.000Z"), ExpiresAt: now.Add(30 * time.Second).Format("2006-01-02T15:04:05.000Z")}, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyProof(proof, session, proof.Method, proof.Path, []byte("{}"), now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	_, wrongPublic, _ := GenerateDeviceIdentity()
	session.ProductDeviceKey = wrongPublic
	if _, err := SignProof(session, proof, key); err == nil {
		t.Fatal("wrong device was accepted")
	}
}
