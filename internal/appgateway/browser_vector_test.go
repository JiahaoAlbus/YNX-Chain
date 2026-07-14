package appgateway

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/JiahaoAlbus/YNX-Chain/internal/square"
)

func TestBrowserSignerVectorsVerifyInGo(t *testing.T) {
	var vector struct {
		Account struct {
			YNX       string `json:"ynx"`
			EVM       string `json:"evm"`
			PublicKey string `json:"publicKey"`
		} `json:"account"`
		Device struct {
			ID               string `json:"id"`
			SigningPublicKey string `json:"signingPublicKey"`
		} `json:"device"`
		Ownership struct {
			SignBytes        string `json:"signBytes"`
			AccountSignature string `json:"accountSignature"`
			DeviceSignature  string `json:"deviceSignature"`
		} `json:"ownership"`
		Registration struct {
			IdempotencyKey string `json:"idempotencyKey"`
			ProofSignature string `json:"proofSignature"`
		} `json:"registration"`
		Request struct {
			Method    string `json:"method"`
			URI       string `json:"uri"`
			Timestamp string `json:"timestamp"`
			Body      string `json:"body"`
			Signature string `json:"signature"`
		} `json:"request"`
	}
	data, err := os.ReadFile("../../testdata/browser-signer-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &vector); err != nil {
		t.Fatal(err)
	}
	signBytes, err := base64.RawURLEncoding.DecodeString(vector.Ownership.SignBytes)
	if err != nil {
		t.Fatal(err)
	}
	if !verifyAccountOwnership(vector.Account.EVM, vector.Account.PublicKey, vector.Ownership.AccountSignature, signBytes) {
		t.Fatal("browser account ownership signature did not verify in Go")
	}
	if !nativewallet.Verify(vector.Device.SigningPublicKey, signBytes, vector.Ownership.DeviceSignature) {
		t.Fatal("browser device ownership signature did not verify in Go")
	}
	registration := square.RegisterDeviceRequest{
		IdempotencyKey:   vector.Registration.IdempotencyKey,
		Account:          vector.Account.YNX,
		DeviceID:         vector.Device.ID,
		SigningPublicKey: vector.Device.SigningPublicKey,
	}
	if !nativewallet.Verify(vector.Device.SigningPublicKey, square.DeviceRegistrationPayload(registration), vector.Registration.ProofSignature) {
		t.Fatal("browser Square registration proof did not verify in Go")
	}
	if !nativewallet.Verify(vector.Device.SigningPublicKey, square.RequestSignaturePayload(vector.Request.Method, vector.Request.URI, vector.Request.Timestamp, []byte(vector.Request.Body)), vector.Request.Signature) {
		t.Fatal("browser Square request signature did not verify in Go")
	}
}
