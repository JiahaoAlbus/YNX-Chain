package cloud

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"mime"
	"path/filepath"
	"strings"
)

type Scanner interface {
	Scan(context.Context, string, string, []byte) error
}

type BoundedScanner struct{}

func (BoundedScanner) Scan(_ context.Context, name, mimeType string, content []byte) error {
	if len(content) > MaxUploadBytes {
		return fmt.Errorf("file exceeds %d byte limit", MaxUploadBytes)
	}
	ext := strings.ToLower(filepath.Ext(name))
	blocked := map[string]bool{".exe": true, ".dll": true, ".dylib": true, ".scr": true, ".bat": true, ".cmd": true}
	if blocked[ext] {
		return errors.New("executable file type is not accepted")
	}
	allowed := strings.HasPrefix(mimeType, "text/") || strings.HasPrefix(mimeType, "image/") || strings.HasPrefix(mimeType, "audio/") || strings.HasPrefix(mimeType, "video/") || mimeType == "application/pdf" || mimeType == "application/json" || mimeType == "application/octet-stream"
	if !allowed {
		return errors.New("file MIME type is not accepted")
	}
	if bytes.Contains(bytes.ToUpper(content), []byte("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
		return errors.New("malware scanner rejected content")
	}
	if detected := mime.TypeByExtension(ext); detected != "" && mimeType != "application/octet-stream" && !strings.HasPrefix(detected, strings.Split(mimeType, ";")[0]) {
		return errors.New("file extension and MIME type do not match")
	}
	return nil
}

type WalletAssertion struct {
	Product         string   `json:"product"`
	ClientID        string   `json:"clientId"`
	BundleID        string   `json:"bundleId"`
	Callback        string   `json:"callback"`
	Account         string   `json:"account"`
	ChainID         string   `json:"chainId"`
	Scopes          []string `json:"scopes"`
	Nonce           string   `json:"nonce"`
	ExpiresAt       string   `json:"expiresAt"`
	DevicePublicKey string   `json:"devicePublicKey"`
	Signature       string   `json:"signature"`
}

type WalletVerifier interface {
	Verify(context.Context, WalletAssertion) error
}

type UnavailableWalletVerifier struct{}

func (UnavailableWalletVerifier) Verify(context.Context, WalletAssertion) error {
	return errors.New("YNX Wallet verifier is not configured")
}

type AIProvider interface {
	Status(context.Context) (provider, model string, available bool)
	Complete(context.Context, string, []AIContext) (string, error)
}

type AIContext struct {
	ObjectID string `json:"objectId"`
	Version  int    `json:"version"`
	Name     string `json:"name"`
	Content  string `json:"content"`
}

type UnavailableAIProvider struct{}

func (UnavailableAIProvider) Status(context.Context) (string, string, bool) {
	return "YNX AI Gateway", "unconfigured", false
}
func (UnavailableAIProvider) Complete(context.Context, string, []AIContext) (string, error) {
	return "", errors.New("YNX AI Gateway provider is unavailable")
}
