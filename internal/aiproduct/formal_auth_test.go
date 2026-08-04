package aiproduct

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	secpECDSA "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

func formalFixture(t *testing.T) (*Store, *ecdsa.PrivateKey, *secp256k1.PrivateKey, FormalRequestOutput) {
	t.Helper()
	store, err := NewStore(filepath.Join(t.TempDir(), "formal.json"), bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 16, 4, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	device, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	deviceKey := base64.RawURLEncoding.EncodeToString(elliptic.MarshalCompressed(elliptic.P256(), device.PublicKey.X, device.PublicKey.Y))
	request, err := store.CreateFormalWalletRequest(FormalRequestInput{ProductDeviceKey: deviceKey})
	if err != nil {
		t.Fatal(err)
	}
	return store, device, secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 1)), request
}

func signedFormalApproval(t *testing.T, request FormalRequestOutput, accountKey *secp256k1.PrivateKey) FormalAuthorizationResponse {
	t.Helper()
	canonicalAddress, err := consensus.NativeAddress(accountKey.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	account, err := accountaddress.Encode(canonicalAddress)
	if err != nil {
		t.Fatal(err)
	}
	response := FormalAuthorizationResponse{Version: "1", RequestDigest: request.RequestDigest, Nonce: request.Request.Nonce, ChainID: request.Request.ChainID, RequestingProduct: request.Request.RequestingProduct, ProductClientID: request.Request.ProductClientID, BundleID: request.Request.BundleID, ProductDeviceAlgorithm: request.Request.ProductDeviceAlgorithm, ProductDeviceKey: request.Request.ProductDeviceKey, Callback: request.Request.Callback, Account: account, AccountPublicKey: hex.EncodeToString(accountKey.PubKey().SerializeCompressed()), GrantedScopes: append([]string(nil), request.Request.Scopes...), Purpose: request.Request.Purpose, IssuedAt: request.Request.IssuedAt, ExpiresAt: request.Request.ExpiresAt}
	raw, _ := json.Marshal(response)
	var payload map[string]any
	_ = json.Unmarshal(raw, &payload)
	delete(payload, "walletSignature")
	canonical, err := canonicalJSON(payload)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte("YNX_WALLET_AUTH_APPROVAL_V1\n" + canonical))
	compact := secpECDSA.SignCompact(accountKey, digest[:], false)
	response.WalletSignature = hex.EncodeToString(compact[1:])
	return response
}

func TestFormalWalletSessionBindsOfficialProtocolScopesAndRejectsReplay(t *testing.T) {
	store, device, accountKey, request := formalFixture(t)
	response := signedFormalApproval(t, request, accountKey)
	approval, err := store.ApproveFormalWallet(FormalApprovalInput{Response: response})
	if err != nil {
		t.Fatal(err)
	}
	signBytes, err := formalGatewaySignBytes(approval.Challenge)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte(signBytes))
	signature, err := ecdsa.SignASN1(rand.Reader, device, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	completion := FormalCompletionInput{Challenge: approval.Challenge, DeviceSignature: base64.RawURLEncoding.EncodeToString(signature)}
	session, err := store.CompleteFormalWallet(completion)
	if err != nil {
		t.Fatal(err)
	}
	if session.Account != response.Account || session.DeviceID != request.Request.ProductDeviceKey || len(session.Scopes) != len(FormalScopes) {
		t.Fatalf("formal session binding mismatch: %+v", session)
	}
	if _, err := store.CompleteFormalWallet(completion); err == nil {
		t.Fatal("formal product challenge replay was accepted")
	}
	restarted, err := NewStore(store.path, bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	restarted.now = store.now
	if _, err := restarted.Authenticate(session.Token, session.DeviceID); err != nil {
		t.Fatalf("formal session did not survive restart: %v", err)
	}
}

func TestFormalWalletRejectsTamperAndScopeEscalation(t *testing.T) {
	store, device, accountKey, request := formalFixture(t)
	_ = device
	response := signedFormalApproval(t, request, accountKey)
	response.Callback = "attacker://wallet-auth/callback"
	if _, err := store.ApproveFormalWallet(FormalApprovalInput{Response: response}); err == nil {
		t.Fatal("callback substitution was accepted")
	}
	store2, _, accountKey2, request2 := formalFixture(t)
	response2 := signedFormalApproval(t, request2, accountKey2)
	response2.GrantedScopes = append(response2.GrantedScopes, "wallet:sign")
	if _, err := store2.ApproveFormalWallet(FormalApprovalInput{Response: response2}); err == nil {
		t.Fatal("scope escalation was accepted")
	}
}

func TestFormalWalletRejectsChallengeMutationBeforeDeviceVerification(t *testing.T) {
	store, device, accountKey, request := formalFixture(t)
	response := signedFormalApproval(t, request, accountKey)
	approval, err := store.ApproveFormalWallet(FormalApprovalInput{Response: response})
	if err != nil {
		t.Fatal(err)
	}
	mutated := approval.Challenge
	mutated.Scopes = []string{"ai:generate"}
	signBytes, _ := formalGatewaySignBytes(mutated)
	digest := sha256.Sum256([]byte(signBytes))
	signature, _ := ecdsa.SignASN1(rand.Reader, device, digest[:])
	if _, err := store.CompleteFormalWallet(FormalCompletionInput{Challenge: mutated, DeviceSignature: base64.RawURLEncoding.EncodeToString(signature)}); err == nil {
		t.Fatal("re-signed mutated Gateway challenge was accepted")
	}
}
