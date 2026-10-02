package commerce

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"sort"
	"strings"
	"time"
)

const (
	providerModeDisabled   = "disabled"
	providerModeSandbox    = "sandbox"
	providerModeTestnet    = "testnet"
	providerModeProduction = "production"

	providerHealthDisabled    = "disabled"
	providerHealthUntested    = "untested"
	providerHealthTesting     = "testing"
	providerHealthHealthy     = "healthy"
	providerHealthDegraded    = "degraded"
	providerHealthUnavailable = "unavailable"
	providerHealthRejected    = "rejected"

	providerTestLimit  = 3
	providerTestWindow = time.Hour
)

var providerCapabilities = map[string][]string{
	"shipping": {"labels", "quotes", "tracking"},
	"tax":      {"estimate", "tax_id_validation"},
	"address":  {"normalize", "validate"},
	"storage":  {"delete", "signed_url", "upload"},
	"email":    {"templates", "transactional"},
	"webhook":  {"delivery", "retry", "signature"},
	"pay":      {"refunds", "settlement"},
	"trust":    {"appeals", "disputes"},
}

type ProviderConfigInput struct {
	Mode, Endpoint, AccessRef string
	Capabilities              []string
	IdempotencyKey            string
}

type ProviderDisableInput struct {
	Reason, IdempotencyKey string
}

type ProviderRotationInput struct {
	AccessRef      string
	RotatedAt      time.Time
	IdempotencyKey string
}

type ProviderTestRequest struct {
	Actor, StoreID, Kind, Mode, Endpoint string
	AccessRef                            string `json:"-"`
	Capabilities                         []string
	Revision, Generation                 int64
}

type ProviderTestResult struct {
	Status, Detail string
}

type ProviderTester interface {
	TestProvider(context.Context, ProviderTestRequest) (ProviderTestResult, error)
}

type ProviderTesterFunc func(context.Context, ProviderTestRequest) (ProviderTestResult, error)

func (f ProviderTesterFunc) TestProvider(ctx context.Context, request ProviderTestRequest) (ProviderTestResult, error) {
	return f(ctx, request)
}

func ProviderKinds() []string {
	kinds := make([]string, 0, len(providerCapabilities))
	for kind := range providerCapabilities {
		kinds = append(kinds, kind)
	}
	sort.Strings(kinds)
	return kinds
}

func providerKey(storeID, kind string) string { return storeID + "\x00" + kind }

func normalizeProviderKind(kind string) (string, error) {
	kind = strings.ToLower(strings.TrimSpace(kind))
	if _, ok := providerCapabilities[kind]; !ok {
		return "", errors.New("unsupported provider kind")
	}
	return kind, nil
}

func normalizeProviderMode(mode string) (string, error) {
	mode = strings.ToLower(strings.TrimSpace(mode))
	switch mode {
	case providerModeDisabled, providerModeSandbox, providerModeTestnet, providerModeProduction:
		return mode, nil
	default:
		return "", errors.New("provider mode must be disabled, sandbox, testnet or production")
	}
}

func normalizeProviderCapabilities(kind string, requested []string) ([]string, error) {
	allowed := providerCapabilities[kind]
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, capability := range allowed {
		allowedSet[capability] = struct{}{}
	}
	if len(requested) == 0 {
		return append([]string(nil), allowed...), nil
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(requested))
	for _, capability := range requested {
		capability = strings.ToLower(strings.TrimSpace(capability))
		if _, ok := allowedSet[capability]; !ok {
			return nil, fmt.Errorf("unsupported %s provider capability %q", kind, capability)
		}
		if _, duplicate := seen[capability]; duplicate {
			continue
		}
		seen[capability] = struct{}{}
		out = append(out, capability)
	}
	sort.Strings(out)
	return out, nil
}

func validateProviderEndpoint(mode, raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if mode == providerModeDisabled {
		if raw != "" {
			return "", errors.New("disabled provider must not declare an endpoint")
		}
		return "", nil
	}
	if len(raw) < 8 || len(raw) > 512 {
		return "", errors.New("provider endpoint must contain 8 to 512 characters")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return "", errors.New("provider endpoint must be an absolute HTTP(S) URL")
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("provider endpoint must not contain credentials, query parameters or fragments")
	}
	if mode != providerModeSandbox && u.Scheme != "https" {
		return "", errors.New("testnet and production providers require HTTPS")
	}
	if mode == providerModeProduction {
		host := strings.ToLower(u.Hostname())
		if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
			return "", errors.New("production provider endpoint must not use a local hostname")
		}
		if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast()) {
			return "", errors.New("production provider endpoint must not use a private or local address")
		}
	}
	return u.String(), nil
}

func validateProviderAccessRef(mode, raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if mode == providerModeDisabled {
		if raw != "" {
			return "", errors.New("disabled provider must not declare an access reference")
		}
		return "", nil
	}
	if len(raw) < 8 || len(raw) > 256 {
		return "", errors.New("provider access reference must contain 8 to 256 characters")
	}
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("provider access reference is malformed")
	}
	switch u.Scheme {
	case "env", "vault", "kms", "secret-manager":
	default:
		return "", errors.New("provider access reference must use env, vault, kms or secret-manager")
	}
	if strings.Trim(u.Host+u.Path, "/") == "" {
		return "", errors.New("provider access reference target required")
	}
	return u.String(), nil
}

func providerView(config ProviderConfig) ProviderView {
	return ProviderView{
		StoreID: config.StoreID, Kind: config.Kind, Mode: config.Mode, Endpoint: config.Endpoint,
		Health: config.Health, LastError: config.LastError, Capabilities: append([]string(nil), config.Capabilities...),
		HasAccessReference: config.AccessRef != "", Revision: config.Revision, TestGeneration: config.TestGeneration,
		CreatedAt: config.CreatedAt, UpdatedAt: config.UpdatedAt, LastTestAt: config.LastTestAt,
		LastHealthyAt: config.LastHealthyAt, LastRotationAt: config.LastRotationAt,
	}
}

func (s *Store) ProviderConfigs(actor, storeID string) ([]ProviderView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.s.Stores[storeID]; !ok {
		return nil, ErrNotFound
	}
	if err := s.requireSellerLocked(storeID, actor, SellerRoleOwner); err != nil {
		return nil, err
	}
	out := make([]ProviderView, 0)
	for _, config := range s.s.ProviderConfigs {
		if config.StoreID == storeID {
			out = append(out, providerView(config))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Kind < out[j].Kind })
	return out, nil
}

func (s *Store) ConfigureProvider(actor, storeID, kind string, in ProviderConfigInput) (ProviderView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.s.Stores[storeID]; !ok {
		return ProviderView{}, ErrNotFound
	}
	if err := s.requireSellerLocked(storeID, actor, SellerRoleOwner); err != nil {
		return ProviderView{}, err
	}
	var err error
	if kind, err = normalizeProviderKind(kind); err != nil {
		return ProviderView{}, err
	}
	mode, err := normalizeProviderMode(in.Mode)
	if err != nil {
		return ProviderView{}, err
	}
	endpoint, err := validateProviderEndpoint(mode, in.Endpoint)
	if err != nil {
		return ProviderView{}, err
	}
	accessRef, err := validateProviderAccessRef(mode, in.AccessRef)
	if err != nil {
		return ProviderView{}, err
	}
	capabilities, err := normalizeProviderCapabilities(kind, in.Capabilities)
	if err != nil {
		return ProviderView{}, err
	}
	route := "provider.configure." + storeID + "." + kind
	hashOrObject, replay, err := s.idempotencyLocked(actor, route, in.IdempotencyKey, in)
	if err != nil {
		return ProviderView{}, err
	}
	key := providerKey(storeID, kind)
	if replay {
		config, ok := s.s.ProviderConfigs[key]
		if !ok || hashOrObject != key {
			return ProviderView{}, ErrConflict
		}
		return providerView(config), nil
	}

	previous, hadPrevious := s.s.ProviderConfigs[key]
	idemKey := idemMapKey(actor, route, in.IdempotencyKey)
	previousIdem, hadPreviousIdem := s.s.Idempotency[idemKey]
	auditLen := len(s.s.Audits)
	now := s.now()
	config := previous
	if !hadPrevious {
		config = ProviderConfig{StoreID: storeID, Kind: kind, CreatedAt: now}
	}
	config.Mode = mode
	config.Endpoint = endpoint
	config.AccessRef = accessRef
	config.Capabilities = capabilities
	config.Revision++
	config.UpdatedAt = now
	config.LastError = ""
	if mode == providerModeDisabled {
		config.Health = providerHealthDisabled
	} else {
		config.Health = providerHealthUntested
	}
	s.s.ProviderConfigs[key] = config
	s.recordIdempotencyLocked(actor, route, in.IdempotencyKey, hashOrObject, key)
	s.auditLocked(actor, SellerRoleOwner, "provider_configured", "provider", key, config.Health, fmt.Sprintf("kind=%s mode=%s revision=%d capabilities=%s", kind, mode, config.Revision, strings.Join(capabilities, ",")))
	if err := s.persistLocked(); err != nil {
		if hadPrevious {
			s.s.ProviderConfigs[key] = previous
		} else {
			delete(s.s.ProviderConfigs, key)
		}
		if hadPreviousIdem {
			s.s.Idempotency[idemKey] = previousIdem
		} else {
			delete(s.s.Idempotency, idemKey)
		}
		s.s.Audits = s.s.Audits[:auditLen]
		return ProviderView{}, err
	}
	return providerView(config), nil
}

func (s *Store) DisableProvider(actor, storeID, kind string, in ProviderDisableInput) (ProviderView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requireSellerLocked(storeID, actor, SellerRoleOwner); err != nil {
		return ProviderView{}, err
	}
	var err error
	if kind, err = normalizeProviderKind(kind); err != nil {
		return ProviderView{}, err
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if len(in.Reason) > 256 {
		return ProviderView{}, errors.New("provider disable reason must not exceed 256 characters")
	}
	route := "provider.disable." + storeID + "." + kind
	hashOrObject, replay, err := s.idempotencyLocked(actor, route, in.IdempotencyKey, in)
	if err != nil {
		return ProviderView{}, err
	}
	key := providerKey(storeID, kind)
	config, ok := s.s.ProviderConfigs[key]
	if !ok {
		return ProviderView{}, ErrNotFound
	}
	if replay {
		if hashOrObject != key {
			return ProviderView{}, ErrConflict
		}
		return providerView(config), nil
	}
	previous := config
	idemKey := idemMapKey(actor, route, in.IdempotencyKey)
	previousIdem, hadPreviousIdem := s.s.Idempotency[idemKey]
	auditLen := len(s.s.Audits)
	config.Mode = providerModeDisabled
	config.Health = providerHealthDisabled
	config.Endpoint = ""
	config.AccessRef = ""
	config.LastError = ""
	config.Revision++
	config.UpdatedAt = s.now()
	s.s.ProviderConfigs[key] = config
	s.recordIdempotencyLocked(actor, route, in.IdempotencyKey, hashOrObject, key)
	s.auditLocked(actor, SellerRoleOwner, "provider_disabled", "provider", key, providerHealthDisabled, fmt.Sprintf("kind=%s revision=%d reason=%s", kind, config.Revision, in.Reason))
	if err := s.persistLocked(); err != nil {
		s.s.ProviderConfigs[key] = previous
		if hadPreviousIdem {
			s.s.Idempotency[idemKey] = previousIdem
		} else {
			delete(s.s.Idempotency, idemKey)
		}
		s.s.Audits = s.s.Audits[:auditLen]
		return ProviderView{}, err
	}
	return providerView(config), nil
}

func (s *Store) RotateProviderReference(actor, storeID, kind string, in ProviderRotationInput) (ProviderView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requireSellerLocked(storeID, actor, SellerRoleOwner); err != nil {
		return ProviderView{}, err
	}
	var err error
	if kind, err = normalizeProviderKind(kind); err != nil {
		return ProviderView{}, err
	}
	key := providerKey(storeID, kind)
	config, ok := s.s.ProviderConfigs[key]
	if !ok {
		return ProviderView{}, ErrNotFound
	}
	if config.Mode == providerModeDisabled {
		return ProviderView{}, fmt.Errorf("%w: disabled provider cannot rotate access reference", ErrInvalidState)
	}
	accessRef, err := validateProviderAccessRef(config.Mode, in.AccessRef)
	if err != nil {
		return ProviderView{}, err
	}
	now := s.now()
	rotatedAt := in.RotatedAt
	if rotatedAt.IsZero() {
		rotatedAt = now
	}
	if rotatedAt.After(now.Add(5 * time.Minute)) {
		return ProviderView{}, errors.New("provider rotation time must not be in the future")
	}
	route := "provider.rotate." + storeID + "." + kind
	hashOrObject, replay, err := s.idempotencyLocked(actor, route, in.IdempotencyKey, in)
	if err != nil {
		return ProviderView{}, err
	}
	if replay {
		if hashOrObject != key {
			return ProviderView{}, ErrConflict
		}
		return providerView(config), nil
	}
	previous := config
	idemKey := idemMapKey(actor, route, in.IdempotencyKey)
	previousIdem, hadPreviousIdem := s.s.Idempotency[idemKey]
	auditLen := len(s.s.Audits)
	config.AccessRef = accessRef
	config.LastRotationAt = rotatedAt.UTC()
	config.Health = providerHealthUntested
	config.LastError = ""
	config.Revision++
	config.UpdatedAt = now
	s.s.ProviderConfigs[key] = config
	s.recordIdempotencyLocked(actor, route, in.IdempotencyKey, hashOrObject, key)
	s.auditLocked(actor, SellerRoleOwner, "provider_reference_rotated", "provider", key, providerHealthUntested, fmt.Sprintf("kind=%s revision=%d rotated_at=%s", kind, config.Revision, config.LastRotationAt.Format(time.RFC3339)))
	if err := s.persistLocked(); err != nil {
		s.s.ProviderConfigs[key] = previous
		if hadPreviousIdem {
			s.s.Idempotency[idemKey] = previousIdem
		} else {
			delete(s.s.Idempotency, idemKey)
		}
		s.s.Audits = s.s.Audits[:auditLen]
		return ProviderView{}, err
	}
	return providerView(config), nil
}

func (s *Store) BeginProviderTest(actor, storeID, kind string) (ProviderTestRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requireSellerLocked(storeID, actor, SellerRoleOwner); err != nil {
		return ProviderTestRequest{}, err
	}
	var err error
	if kind, err = normalizeProviderKind(kind); err != nil {
		return ProviderTestRequest{}, err
	}
	key := providerKey(storeID, kind)
	config, ok := s.s.ProviderConfigs[key]
	if !ok {
		return ProviderTestRequest{}, ErrNotFound
	}
	if config.Mode == providerModeDisabled {
		return ProviderTestRequest{}, fmt.Errorf("%w: disabled provider cannot be tested", ErrInvalidState)
	}
	now := s.now()
	windowKey := actor + "\x00provider.test\x00" + key
	previousWindow := append([]time.Time(nil), s.s.RequestWindow[windowKey]...)
	cutoff := now.Add(-providerTestWindow)
	recent := make([]time.Time, 0, len(previousWindow))
	for _, at := range previousWindow {
		if at.After(cutoff) {
			recent = append(recent, at)
		}
	}
	if len(recent) >= providerTestLimit {
		return ProviderTestRequest{}, fmt.Errorf("%w: provider test limit exceeded", ErrRateLimited)
	}
	previous := config
	auditLen := len(s.s.Audits)
	recent = append(recent, now)
	s.s.RequestWindow[windowKey] = recent
	config.Health = providerHealthTesting
	config.LastError = ""
	config.LastTestAt = now
	config.UpdatedAt = now
	config.TestGeneration++
	s.s.ProviderConfigs[key] = config
	s.auditLocked(actor, SellerRoleOwner, "provider_test_started", "provider", key, providerHealthTesting, fmt.Sprintf("kind=%s mode=%s revision=%d generation=%d", kind, config.Mode, config.Revision, config.TestGeneration))
	if err := s.persistLocked(); err != nil {
		s.s.ProviderConfigs[key] = previous
		if len(previousWindow) == 0 {
			delete(s.s.RequestWindow, windowKey)
		} else {
			s.s.RequestWindow[windowKey] = previousWindow
		}
		s.s.Audits = s.s.Audits[:auditLen]
		return ProviderTestRequest{}, err
	}
	return ProviderTestRequest{Actor: actor, StoreID: storeID, Kind: kind, Mode: config.Mode, Endpoint: config.Endpoint, AccessRef: config.AccessRef, Capabilities: append([]string(nil), config.Capabilities...), Revision: config.Revision, Generation: config.TestGeneration}, nil
}

func (s *Store) CompleteProviderTest(request ProviderTestRequest, result ProviderTestResult, testErr error) (ProviderView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := providerKey(request.StoreID, request.Kind)
	config, ok := s.s.ProviderConfigs[key]
	if !ok {
		return ProviderView{}, ErrNotFound
	}
	if config.Revision != request.Revision || config.TestGeneration != request.Generation || config.Health != providerHealthTesting {
		return ProviderView{}, fmt.Errorf("%w: provider configuration changed while test was running", ErrConflict)
	}
	status := strings.ToLower(strings.TrimSpace(result.Status))
	detail := strings.TrimSpace(result.Detail)
	if testErr != nil {
		status = providerHealthUnavailable
		if errors.Is(testErr, context.DeadlineExceeded) || errors.Is(testErr, context.Canceled) {
			detail = "provider test timed out or was cancelled"
		} else {
			detail = "provider test failed"
		}
	}
	switch status {
	case providerHealthHealthy, providerHealthDegraded, providerHealthUnavailable, providerHealthRejected:
	default:
		status = providerHealthUnavailable
		detail = "provider tester returned an invalid status"
	}
	if len(detail) > 256 {
		detail = detail[:256]
	}
	previous := config
	auditLen := len(s.s.Audits)
	now := s.now()
	config.Health = status
	config.LastError = ""
	if status != providerHealthHealthy {
		config.LastError = detail
	} else {
		config.LastHealthyAt = now
	}
	config.LastTestAt = now
	config.UpdatedAt = now
	s.s.ProviderConfigs[key] = config
	s.auditLocked(request.Actor, SellerRoleOwner, "provider_test_completed", "provider", key, status, fmt.Sprintf("kind=%s revision=%d generation=%d detail=%s", request.Kind, request.Revision, request.Generation, detail))
	if err := s.persistLocked(); err != nil {
		s.s.ProviderConfigs[key] = previous
		s.s.Audits = s.s.Audits[:auditLen]
		return ProviderView{}, err
	}
	return providerView(config), nil
}
