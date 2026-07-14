package nativewallet

import (
	"bytes"
	"crypto/ed25519"
	"testing"
)

func TestNativeAddressAndEncryptedDeviceEnvelope(t *testing.T) {
	const address = "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	normalized, err := NormalizeNativeAddress(address)
	if err != nil || normalized != address {
		t.Fatalf("normalize native address: %q %v", normalized, err)
	}
	if _, err := NormalizeNativeAddress("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"); err == nil {
		t.Fatal("native wallet accepted an EVM compatibility address as its default identity")
	}

	alice, err := GenerateDeviceKeys(bytes.NewReader(bytes.Repeat([]byte{0x11}, 256)))
	if err != nil {
		t.Fatal(err)
	}
	bob, err := GenerateDeviceKeys(bytes.NewReader(bytes.Repeat([]byte{0x22}, 256)))
	if err != nil {
		t.Fatal(err)
	}
	aad := []byte("ynx-chat-v1|conversation-1|message-1")
	envelope, err := Encrypt(alice.EncryptionPrivate, bob.EncryptionPublic, []byte("private YNX message"), aad, bytes.NewReader(bytes.Repeat([]byte{0x33}, 24)))
	if err != nil {
		t.Fatal(err)
	}
	plaintext, err := Decrypt(bob.EncryptionPrivate, alice.EncryptionPublic, aad, envelope)
	if err != nil || string(plaintext) != "private YNX message" {
		t.Fatalf("decrypt: %q %v", plaintext, err)
	}
	envelope.Ciphertext = envelope.Ciphertext[:len(envelope.Ciphertext)-1] + "A"
	if _, err := Decrypt(bob.EncryptionPrivate, alice.EncryptionPublic, aad, envelope); err == nil {
		t.Fatal("tampered ciphertext decrypted")
	}

	payload := []byte("YNX signed device proof")
	signature := Sign(alice.SigningPrivate, payload)
	if !Verify(EncodePublicKey(alice.SigningPublic), payload, signature) {
		t.Fatal("device signature did not verify")
	}
	if Verify(EncodePublicKey(ed25519.PublicKey(bob.SigningPublic)), payload, signature) {
		t.Fatal("device signature verified against the wrong device")
	}
}
