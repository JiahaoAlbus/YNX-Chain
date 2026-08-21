package readintegration

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	HeaderConsumer  = "X-YNX-Read-Consumer"
	HeaderAccount   = "X-YNX-Read-Account"
	HeaderTimestamp = "X-YNX-Read-Timestamp"
	HeaderNonce     = "X-YNX-Read-Nonce"
	HeaderSignature = "X-YNX-Read-Signature"
	domain          = "YNX_READ_INTEGRATION_V1"
)

var tokenPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,63}$`)
var noncePattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

type Verifier struct {
	key      []byte
	consumer string
	owner    string
	now      func() time.Time
	mu       sync.Mutex
	consumed map[string]time.Time
}

func NewVerifier(secret, consumer, owner string, now func() time.Time) (*Verifier, error) {
	if len(secret) < 32 || !tokenPattern.MatchString(consumer) || !tokenPattern.MatchString(owner) {
		return nil, errors.New("read integration verifier configuration is invalid")
	}
	if now == nil {
		now = time.Now
	}
	return &Verifier{key: []byte(secret), consumer: consumer, owner: owner, now: now, consumed: map[string]time.Time{}}, nil
}

func Sign(req *http.Request, secret, consumer, owner, account string, at time.Time) error {
	if req == nil || len(secret) < 32 || !tokenPattern.MatchString(consumer) || !tokenPattern.MatchString(owner) || strings.TrimSpace(account) == "" || req.Method != http.MethodGet || req.URL.RawQuery != "" {
		return errors.New("read integration signing input is invalid")
	}
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return err
	}
	nonce := hex.EncodeToString(raw[:])
	timestamp := at.UTC().Format(time.RFC3339Nano)
	signature := digest([]byte(secret), canonical(consumer, owner, req.Method, req.URL.EscapedPath(), account, timestamp, nonce))
	req.Header.Set(HeaderConsumer, consumer)
	req.Header.Set(HeaderAccount, account)
	req.Header.Set(HeaderTimestamp, timestamp)
	req.Header.Set(HeaderNonce, nonce)
	req.Header.Set(HeaderSignature, signature)
	return nil
}

func (v *Verifier) Verify(req *http.Request, expectedPath string) (string, error) {
	if req == nil || req.Method != http.MethodGet || req.URL.EscapedPath() != expectedPath || req.URL.RawQuery != "" || req.Header.Get(HeaderConsumer) != v.consumer {
		return "", errors.New("read integration request binding is invalid")
	}
	account, timestamp := req.Header.Get(HeaderAccount), req.Header.Get(HeaderTimestamp)
	nonce, signature := req.Header.Get(HeaderNonce), req.Header.Get(HeaderSignature)
	at, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil || strings.TrimSpace(account) == "" || !noncePattern.MatchString(nonce) || len(signature) != 64 {
		return "", errors.New("read integration credential is invalid")
	}
	now := v.now().UTC()
	if at.Before(now.Add(-30*time.Second)) || at.After(now.Add(30*time.Second)) {
		return "", errors.New("read integration credential is expired")
	}
	want := digest(v.key, canonical(v.consumer, v.owner, req.Method, expectedPath, account, timestamp, nonce))
	got, err := hex.DecodeString(signature)
	expected, expectedErr := hex.DecodeString(want)
	if err != nil || expectedErr != nil || !hmac.Equal(got, expected) {
		return "", errors.New("read integration signature is invalid")
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	for key, expires := range v.consumed {
		if !expires.After(now) {
			delete(v.consumed, key)
		}
	}
	if _, exists := v.consumed[nonce]; exists {
		return "", errors.New("read integration credential was replayed")
	}
	if len(v.consumed) >= 100_000 {
		return "", errors.New("read integration replay capacity is exhausted")
	}
	v.consumed[nonce] = now.Add(time.Minute)
	return account, nil
}

func canonical(consumer, owner, method, path, account, timestamp, nonce string) string {
	return strings.Join([]string{domain, consumer, owner, method, path, account, timestamp, nonce}, "\n")
}

func digest(key []byte, value string) string {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}
