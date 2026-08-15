package indexer

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	cursorVersion    = 1
	minimumCursorKey = 32
	maximumCursorLen = 2048
)

type cursorCodec struct {
	key        []byte
	persistent bool
}

type cursorPayload struct {
	Version int    `json:"v"`
	Feed    string `json:"f"`
	After   string `json:"a"`
}

func newCursorCodec(key []byte) (*cursorCodec, error) {
	persistent := len(key) > 0
	if !persistent {
		key = make([]byte, minimumCursorKey)
		if _, err := rand.Read(key); err != nil {
			return nil, fmt.Errorf("generate cursor key: %w", err)
		}
	}
	if len(key) < minimumCursorKey {
		return nil, fmt.Errorf("cursor key must contain at least %d bytes", minimumCursorKey)
	}
	owned := append([]byte(nil), key...)
	return &cursorCodec{key: owned, persistent: persistent}, nil
}

func cursorPersistence(codec *cursorCodec) string {
	if codec != nil && codec.persistent {
		return "configured-key"
	}
	return "process-scoped"
}

func (c *cursorCodec) encode(feed, after string) (string, error) {
	if strings.TrimSpace(feed) == "" || strings.TrimSpace(after) == "" {
		return "", fmt.Errorf("cursor feed and position are required")
	}
	body, err := json.Marshal(cursorPayload{Version: cursorVersion, Feed: feed, After: after})
	if err != nil {
		return "", fmt.Errorf("encode cursor payload: %w", err)
	}
	mac := hmac.New(sha256.New, c.key)
	_, _ = mac.Write(body)
	return base64.RawURLEncoding.EncodeToString(body) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func (c *cursorCodec) decode(raw, expectedFeed string) (string, error) {
	if raw == "" {
		return "", nil
	}
	if len(raw) > maximumCursorLen {
		return "", fmt.Errorf("cursor exceeds maximum length")
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", fmt.Errorf("cursor envelope is malformed")
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", fmt.Errorf("cursor payload is malformed")
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("cursor signature is malformed")
	}
	mac := hmac.New(sha256.New, c.key)
	_, _ = mac.Write(body)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return "", fmt.Errorf("cursor signature is invalid")
	}
	var payload cursorPayload
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return "", fmt.Errorf("cursor payload is invalid")
	}
	if payload.Version != cursorVersion {
		return "", fmt.Errorf("cursor version is unsupported")
	}
	if payload.Feed != expectedFeed {
		return "", fmt.Errorf("cursor belongs to a different feed")
	}
	if strings.TrimSpace(payload.After) == "" || len(payload.After) > 512 {
		return "", fmt.Errorf("cursor position is invalid")
	}
	return payload.After, nil
}
