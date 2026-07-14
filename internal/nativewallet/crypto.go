package nativewallet

import (
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"golang.org/x/crypto/chacha20poly1305"
	"golang.org/x/crypto/hkdf"
)

const envelopeInfo = "YNX-NATIVE-WALLET-E2EE-V1"

type DeviceKeys struct {
	SigningPublic     ed25519.PublicKey
	SigningPrivate    ed25519.PrivateKey
	EncryptionPublic  []byte
	EncryptionPrivate []byte
}

type EncryptedEnvelope struct {
	Algorithm  string `json:"algorithm"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

func NormalizeNativeAddress(value string) (string, error) {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(strings.ToLower(value), accountaddress.HRP+"1") {
		return "", errors.New("YNX-native account must use the ynx1 address format")
	}
	evm, err := accountaddress.Normalize(value)
	if err != nil {
		return "", err
	}
	return accountaddress.Encode(evm)
}

func GenerateDeviceKeys(reader io.Reader) (DeviceKeys, error) {
	if reader == nil {
		reader = rand.Reader
	}
	public, private, err := ed25519.GenerateKey(reader)
	if err != nil {
		return DeviceKeys{}, fmt.Errorf("generate signing key: %w", err)
	}
	encryptionPrivate, err := ecdh.X25519().GenerateKey(reader)
	if err != nil {
		return DeviceKeys{}, fmt.Errorf("generate encryption key: %w", err)
	}
	return DeviceKeys{
		SigningPublic: public, SigningPrivate: private,
		EncryptionPublic:  encryptionPrivate.PublicKey().Bytes(),
		EncryptionPrivate: encryptionPrivate.Bytes(),
	}, nil
}

func Encrypt(senderPrivate, recipientPublic, plaintext, additionalData []byte, reader io.Reader) (EncryptedEnvelope, error) {
	if reader == nil {
		reader = rand.Reader
	}
	aead, err := envelopeAEAD(senderPrivate, recipientPublic)
	if err != nil {
		return EncryptedEnvelope{}, err
	}
	nonce := make([]byte, chacha20poly1305.NonceSizeX)
	if _, err := io.ReadFull(reader, nonce); err != nil {
		return EncryptedEnvelope{}, fmt.Errorf("generate envelope nonce: %w", err)
	}
	ciphertext := aead.Seal(nil, nonce, plaintext, additionalData)
	return EncryptedEnvelope{Algorithm: "x25519-hkdf-sha256-xchacha20poly1305", Nonce: base64.RawStdEncoding.EncodeToString(nonce), Ciphertext: base64.RawStdEncoding.EncodeToString(ciphertext)}, nil
}

func Decrypt(recipientPrivate, senderPublic, additionalData []byte, envelope EncryptedEnvelope) ([]byte, error) {
	if envelope.Algorithm != "x25519-hkdf-sha256-xchacha20poly1305" {
		return nil, errors.New("unsupported YNX wallet envelope algorithm")
	}
	nonce, err := base64.RawStdEncoding.DecodeString(envelope.Nonce)
	if err != nil || len(nonce) != chacha20poly1305.NonceSizeX {
		return nil, errors.New("invalid YNX wallet envelope nonce")
	}
	ciphertext, err := base64.RawStdEncoding.DecodeString(envelope.Ciphertext)
	if err != nil || len(ciphertext) < chacha20poly1305.Overhead {
		return nil, errors.New("invalid YNX wallet envelope ciphertext")
	}
	aead, err := envelopeAEAD(recipientPrivate, senderPublic)
	if err != nil {
		return nil, err
	}
	plaintext, err := aead.Open(nil, nonce, ciphertext, additionalData)
	if err != nil {
		return nil, errors.New("YNX wallet envelope authentication failed")
	}
	return plaintext, nil
}

func Sign(private ed25519.PrivateKey, payload []byte) string {
	return base64.RawStdEncoding.EncodeToString(ed25519.Sign(private, payload))
}

func Verify(publicKeyText string, payload []byte, signatureText string) bool {
	publicKey, err := DecodePublicKey(publicKeyText, ed25519.PublicKeySize)
	if err != nil {
		return false
	}
	signature, err := base64.RawStdEncoding.DecodeString(signatureText)
	return err == nil && ed25519.Verify(ed25519.PublicKey(publicKey), payload, signature)
}

func EncodePublicKey(value []byte) string { return base64.RawStdEncoding.EncodeToString(value) }

func DecodePublicKey(value string, size int) ([]byte, error) {
	decoded, err := base64.RawStdEncoding.DecodeString(strings.TrimSpace(value))
	if err != nil || len(decoded) != size {
		return nil, fmt.Errorf("public key must be raw base64 encoding of %d bytes", size)
	}
	return decoded, nil
}

func envelopeAEAD(privateBytes, publicBytes []byte) (cipher.AEAD, error) {
	privateKey, err := ecdh.X25519().NewPrivateKey(privateBytes)
	if err != nil {
		return nil, errors.New("invalid X25519 private key")
	}
	publicKey, err := ecdh.X25519().NewPublicKey(publicBytes)
	if err != nil {
		return nil, errors.New("invalid X25519 public key")
	}
	shared, err := privateKey.ECDH(publicKey)
	if err != nil {
		return nil, errors.New("X25519 key agreement failed")
	}
	key := make([]byte, chacha20poly1305.KeySize)
	if _, err := io.ReadFull(hkdf.New(sha256.New, shared, nil, []byte(envelopeInfo)), key); err != nil {
		return nil, fmt.Errorf("derive envelope key: %w", err)
	}
	return chacha20poly1305.NewX(key)
}
