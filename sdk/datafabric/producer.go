package datafabric

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	core "github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

type ProducerReceipt struct {
	EventID string `json:"eventId"`
	Status  string `json:"status"`
	AuditID string `json:"auditId"`
}

type ProducerClient struct {
	endpoint   string
	keyID      string
	key        []byte
	HTTPClient *http.Client
	now        func() time.Time
	nonce      func() (string, error)
}

func NewProducerClient(endpoint, keyID string, key []byte) (*ProducerClient, error) {
	endpoint = strings.TrimRight(strings.TrimSpace(endpoint), "/")
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" {
		return nil, errors.New("Data Fabric producer endpoint must be an absolute origin URL")
	}
	host := parsed.Hostname()
	ip := net.ParseIP(host)
	loopback := host == "localhost" || ip != nil && ip.IsLoopback()
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && loopback) {
		return nil, errors.New("Data Fabric producer endpoint must use HTTPS except on loopback")
	}
	if len(key) < 32 {
		return nil, errors.New("Data Fabric producer signing key must contain at least 32 bytes")
	}
	if _, err := core.ProducerDeliverySignature(keyID, time.Unix(0, 0).UTC().Format(time.RFC3339Nano), "nonce.validation.0001", []byte("{}"), key); err != nil {
		return nil, err
	}
	return &ProducerClient{
		endpoint: endpoint, keyID: keyID, key: append([]byte(nil), key...),
		HTTPClient: &http.Client{Timeout: 15 * time.Second}, now: func() time.Time { return time.Now().UTC() },
		nonce: producerNonce,
	}, nil
}

func (c *ProducerClient) Send(ctx context.Context, event EventEnvelope) (ProducerReceipt, error) {
	if c == nil || c.HTTPClient == nil {
		return ProducerReceipt{}, errors.New("Data Fabric producer client is not initialized")
	}
	if event.Integrity.KeyID != c.keyID {
		return ProducerReceipt{}, errors.New("event integrity key does not match producer client")
	}
	if err := event.Verify(c.key); err != nil {
		return ProducerReceipt{}, fmt.Errorf("verify producer event before delivery: %w", err)
	}
	body, err := json.Marshal(event)
	if err != nil {
		return ProducerReceipt{}, err
	}
	at := c.now().UTC().Format(time.RFC3339Nano)
	nonce, err := c.nonce()
	if err != nil {
		return ProducerReceipt{}, err
	}
	signature, err := core.ProducerDeliverySignature(c.keyID, at, nonce, body, c.key)
	if err != nil {
		return ProducerReceipt{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint+core.ProducerEventsPath, bytes.NewReader(body))
	if err != nil {
		return ProducerReceipt{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(core.ProducerKeyIDHeader, c.keyID)
	request.Header.Set(core.ProducerTimestampHeader, at)
	request.Header.Set(core.ProducerNonceHeader, nonce)
	request.Header.Set(core.ProducerSignatureHeader, signature)
	response, err := c.HTTPClient.Do(request)
	if err != nil {
		return ProducerReceipt{}, fmt.Errorf("deliver product event to Data Fabric: %w", err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 64*1024+1))
	if err != nil || len(payload) > 64*1024 {
		return ProducerReceipt{}, errors.New("Data Fabric producer response exceeds the canonical limit")
	}
	if response.StatusCode != http.StatusAccepted && response.StatusCode != http.StatusOK {
		var rejection struct {
			Code  string `json:"code"`
			Error string `json:"error"`
		}
		_ = json.Unmarshal(payload, &rejection)
		message := strings.TrimSpace(rejection.Code + " " + rejection.Error)
		if message == "" {
			message = http.StatusText(response.StatusCode)
		}
		return ProducerReceipt{}, fmt.Errorf("Data Fabric producer delivery returned %d: %s", response.StatusCode, message)
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var receipt ProducerReceipt
	if err := decoder.Decode(&receipt); err != nil {
		return ProducerReceipt{}, errors.New("Data Fabric producer receipt is invalid")
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return ProducerReceipt{}, errors.New("Data Fabric producer receipt contains trailing JSON")
	}
	if receipt.EventID != event.EventID || receipt.AuditID != event.AuditID || receipt.Status != "committed-to-outbox" && receipt.Status != "already-committed" {
		return ProducerReceipt{}, errors.New("Data Fabric producer receipt contradicts the delivered event")
	}
	return receipt, nil
}

func producerNonce() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", errors.New("generate producer delivery nonce")
	}
	return "nonce.producer." + hex.EncodeToString(value[:]), nil
}
