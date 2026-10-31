//go:build pay_securelink

package payproduct

import (
	"errors"
	"io"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)

type productionLinkConfig struct {
	TLS            native.Config     `json:"tls"`
	Policy         securelink.Policy `json:"policy"`
	EdgeID         string            `json:"edgeId"`
	Address        string            `json:"address"`
	Origin         string            `json:"origin"`
	TimeoutSeconds int               `json:"timeoutSeconds"`
	MaxConnections int               `json:"maxConnections"`
}

// NewProductionHTTPPayAPI installs LINK's exact native client at the existing
// caller. Policy/routes/identities come only from the operator's owned file;
// neither an HTTP argument nor a discovered invoice can extend that policy.
func NewProductionHTTPPayAPI(baseURL, apiKey, configPath string) (*HTTPPayAPI, error) {
	if configPath == "" {
		return nil, errors.New("Pay central securelink configuration not supplied")
	}
	f, err := os.Open(configPath)
	if err != nil {
		return nil, errors.New("Pay central securelink configuration unavailable")
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		return nil, errors.New("Pay central securelink configuration exceeds bounds")
	}
	var cfg productionLinkConfig
	if strictJSON(raw, &cfg) != nil {
		return nil, errors.New("Pay central securelink configuration invalid")
	}
	if baseURL != cfg.Origin || strings.TrimSpace(baseURL) != baseURL || cfg.TimeoutSeconds < 0 || cfg.TimeoutSeconds > 60 {
		return nil, errors.New("Pay central securelink origin or timeout mismatch")
	}
	if cfg.TimeoutSeconds == 0 {
		cfg.TimeoutSeconds = 15
	}
	gate, err := securelink.NewGate(cfg.Policy)
	if err != nil {
		return nil, err
	}
	client, err := securelink.NewHTTPClient(securelink.HTTPClientConfig{TLS: cfg.TLS, Gate: gate, EdgeID: cfg.EdgeID, Address: cfg.Address, Origin: cfg.Origin, Timeout: time.Duration(cfg.TimeoutSeconds) * time.Second, MaxConnections: cfg.MaxConnections, MaxResponseBytes: 2 << 20})
	if err != nil {
		return nil, err
	}
	pay, err := NewHTTPPayAPI(baseURL, apiKey)
	if err != nil {
		client.Transport.(*securelink.Transport).Close()
		return nil, err
	}
	pay.Client = client
	return pay, nil
}
