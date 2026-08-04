package canonicalwallet

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"
)

const ChainID = "ynx_6423-1"

type Registry struct {
	SchemaVersion           int      `json:"schemaVersion"`
	ProductClientID         string   `json:"productClientId"`
	RequestingProduct       string   `json:"requestingProduct"`
	BundleID                string   `json:"bundleId"`
	Callbacks               []string `json:"callbacks"`
	Scopes                  []string `json:"scopes"`
	MaxScopes               int      `json:"maxScopes"`
	ProductDeviceAlgorithms []string `json:"productDeviceAlgorithms"`
}

type Session struct {
	VerifierVersion        string    `json:"verifierVersion"`
	SessionBinding         string    `json:"sessionBinding"`
	ChainID                string    `json:"chainId"`
	RequestingProduct      string    `json:"requestingProduct"`
	ProductClientID        string    `json:"productClientId"`
	BundleID               string    `json:"bundleId"`
	Callback               string    `json:"callback"`
	ProductDeviceAlgorithm string    `json:"productDeviceAlgorithm"`
	ProductDeviceKey       string    `json:"productDeviceKey"`
	DeviceBinding          string    `json:"deviceBinding"`
	Account                string    `json:"account"`
	Scopes                 []string  `json:"scopes"`
	Nonce                  string    `json:"nonce"`
	Purpose                string    `json:"purpose"`
	RequestDigest          string    `json:"requestDigest"`
	ApprovalDigest         string    `json:"approvalDigest"`
	IssuedAt               time.Time `json:"issuedAt"`
	ExpiresAt              time.Time `json:"expiresAt"`
}

func ParseVerifiedSession(raw []byte, registry Registry, now time.Time) (Session, error) {
	var s Session
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&s); err != nil {
		return s, fmt.Errorf("central canonical session schema: %w", err)
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		return s, errors.New("central canonical session must be one exact JSON object")
	}
	if s.VerifierVersion != "wallet-auth-v1" || s.ChainID != ChainID || s.ProductClientID != registry.ProductClientID || s.RequestingProduct != registry.RequestingProduct || s.BundleID != registry.BundleID || s.ProductDeviceAlgorithm != "p256-sha256" {
		return s, errors.New("central canonical session product binding mismatch")
	}
	if !contains(registry.Callbacks, s.Callback) || !subset(s.Scopes, registry.Scopes) || len(s.Scopes) == 0 || len(s.Scopes) > registry.MaxScopes {
		return s, errors.New("central canonical session callback or scope binding mismatch")
	}
	for name, value := range map[string]string{"sessionBinding": s.SessionBinding, "requestDigest": s.RequestDigest, "approvalDigest": s.ApprovalDigest, "deviceBinding": s.DeviceBinding} {
		if len(value) != 64 || strings.Trim(value, "0123456789abcdef") != "" {
			return s, fmt.Errorf("central canonical session %s is invalid", name)
		}
	}
	if s.ProductDeviceKey == "" || s.Account == "" || s.Nonce == "" || s.Purpose == "" || s.IssuedAt.After(now.Add(time.Minute)) || !s.ExpiresAt.After(now) || s.ExpiresAt.After(s.IssuedAt.Add(15*time.Minute)) {
		return s, errors.New("central canonical session lifetime or identity binding mismatch")
	}
	return s, nil
}

func AssertActive(s Session, binding, deviceKey string, requiredScopes []string, now time.Time) error {
	if binding == "" || binding != s.SessionBinding || deviceKey == "" || deviceKey != s.ProductDeviceKey {
		return errors.New("canonical Wallet session cannot be reused by another App or device")
	}
	if !s.ExpiresAt.After(now) {
		return errors.New("canonical Wallet session expired")
	}
	if !subset(requiredScopes, s.Scopes) {
		return errors.New("canonical Wallet session scope denied")
	}
	return nil
}

func (r Registry) Validate() error {
	if r.SchemaVersion != 2 || r.ProductClientID == "" || r.RequestingProduct == "" || r.BundleID == "" || len(r.Callbacks) == 0 || len(r.Scopes) == 0 || r.MaxScopes != len(r.Scopes) || len(r.ProductDeviceAlgorithms) != 1 || r.ProductDeviceAlgorithms[0] != "p256-sha256" {
		return errors.New("invalid canonical registry entry")
	}
	if !sort.StringsAreSorted(r.Callbacks) || !sort.StringsAreSorted(r.Scopes) {
		return errors.New("canonical registry arrays must be sorted")
	}
	return nil
}

func contains(xs []string, value string) bool {
	for _, x := range xs {
		if x == value {
			return true
		}
	}
	return false
}
func subset(xs, allowed []string) bool {
	for _, x := range xs {
		if !contains(allowed, x) {
			return false
		}
	}
	return true
}
