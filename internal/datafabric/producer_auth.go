package datafabric

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

const (
	ProducerEventsPath      = "/v1/producer/events"
	ProducerKeyIDHeader     = "X-YNX-Producer-Key-ID"
	ProducerTimestampHeader = "X-YNX-Producer-Timestamp"
	ProducerNonceHeader     = "X-YNX-Producer-Nonce"
	ProducerSignatureHeader = "X-YNX-Producer-Signature"
)

// ProducerDeliverySignature binds one product delivery attempt to the exact
// canonical event bytes. The event itself remains independently signed, so the
// transport binding cannot change product authority or event history.
func ProducerDeliverySignature(keyID, timestamp, nonce string, body, key []byte) (string, error) {
	if !idPattern.MatchString(keyID) || !idPattern.MatchString(nonce) {
		return "", errors.New("producer key ID and nonce must be canonical identifiers")
	}
	parsed, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil || parsed.Location() != time.UTC {
		return "", errors.New("producer timestamp must be canonical RFC3339Nano UTC")
	}
	if len(body) == 0 || len(key) < 32 {
		return "", errors.New("producer delivery requires body bytes and a 32-byte signing key")
	}
	bodyDigest := sha256.Sum256(body)
	material := strings.Join([]string{
		"ynx-data-fabric-producer-v1",
		"POST",
		ProducerEventsPath,
		keyID,
		timestamp,
		nonce,
		hex.EncodeToString(bodyDigest[:]),
	}, "\x00")
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(material))
	return hex.EncodeToString(mac.Sum(nil)), nil
}

func VerifyProducerDeliverySignature(signature, keyID, timestamp, nonce string, body, key []byte) error {
	expected, err := ProducerDeliverySignature(keyID, timestamp, nonce, body, key)
	if err != nil {
		return err
	}
	provided, err := hex.DecodeString(signature)
	if err != nil {
		return ErrTampered
	}
	decodedExpected, _ := hex.DecodeString(expected)
	if !hmac.Equal(provided, decodedExpected) {
		return ErrTampered
	}
	return nil
}
