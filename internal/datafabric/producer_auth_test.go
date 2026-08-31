package datafabric

import (
	"errors"
	"testing"
	"time"
)

func TestProducerDeliverySignatureBindsBodyNonceAndProductKey(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	at := time.Date(2026, 7, 26, 10, 0, 0, 0, time.UTC).Format(time.RFC3339Nano)
	body := []byte(`{"eventId":"event.pay.test.0001"}`)
	signature, err := ProducerDeliverySignature("key.pay.testnet.0001", at, "nonce.pay.delivery.0001", body, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyProducerDeliverySignature(signature, "key.pay.testnet.0001", at, "nonce.pay.delivery.0001", body, key); err != nil {
		t.Fatalf("valid producer delivery signature was rejected: %v", err)
	}
	for _, changed := range []struct {
		keyID, nonce string
		body         []byte
	}{
		{keyID: "key.pay.testnet.0002", nonce: "nonce.pay.delivery.0001", body: body},
		{keyID: "key.pay.testnet.0001", nonce: "nonce.pay.delivery.0002", body: body},
		{keyID: "key.pay.testnet.0001", nonce: "nonce.pay.delivery.0001", body: []byte(`{"eventId":"event.pay.test.0002"}`)},
	} {
		if err := VerifyProducerDeliverySignature(signature, changed.keyID, at, changed.nonce, changed.body, key); !errors.Is(err, ErrTampered) {
			t.Fatalf("changed producer binding was accepted: %v", err)
		}
	}
}

func TestProducerDeliverySignatureMatchesTypeScriptSDKVector(t *testing.T) {
	signature, err := ProducerDeliverySignature(
		"key.sdk.0001",
		"2026-07-22T16:00:00Z",
		"nonce.sdk.0001",
		[]byte(`{"eventId":"event.test.0001"}`),
		[]byte("0123456789abcdef0123456789abcdef"),
	)
	if err != nil {
		t.Fatal(err)
	}
	const expected = "88e8d9488d71707904344a2cbf86844d845250fc54a4415f9cc7e6ecee24d1a1"
	if signature != expected {
		t.Fatalf("producer delivery signature drifted from the cross-language vector: got %s want %s", signature, expected)
	}
}
