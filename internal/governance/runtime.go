package governance

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"
)

type RuntimePolicyConfig struct {
	MinimumDeposit              uint64                   `json:"minimumDeposit"`
	QuorumBPS                   uint64                   `json:"quorumBps"`
	ThresholdBPS                uint64                   `json:"thresholdBps"`
	VotingPeriod                string                   `json:"votingPeriod"`
	Timelock                    string                   `json:"timelock"`
	MaxLifetime                 string                   `json:"maxLifetime"`
	EmergencyThreshold          uint64                   `json:"emergencyThreshold"`
	EmergencyMaxDuration        string                   `json:"emergencyMaxDuration"`
	ParameterRules              map[string]ParameterRule `json:"parameterRules"`
	GenesisRoleManifestHash     string                   `json:"genesisRoleManifestHash"`
	ElectorateApprovalThreshold uint64                   `json:"electorateApprovalThreshold"`
}

type RuntimeConfig struct {
	SchemaVersion  string                `json:"schemaVersion"`
	HTTPAddress    string                `json:"httpAddress"`
	StatePath      string                `json:"statePath"`
	GatewayKeyPath string                `json:"gatewayKeyPath"`
	Policy         RuntimePolicyConfig   `json:"policy"`
	GenesisRoles   []RoleAssignmentInput `json:"genesisRoles"`
}

func LoadRuntimeConfig(path string) (RuntimeConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return RuntimeConfig{}, err
	}
	var cfg RuntimeConfig
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&cfg); err != nil {
		return RuntimeConfig{}, fmt.Errorf("%w: invalid governance runtime config", ErrInvalid)
	}
	return cfg, nil
}

func (cfg RuntimeConfig) PolicyValue() (Policy, error) {
	voting, err := time.ParseDuration(cfg.Policy.VotingPeriod)
	if err != nil {
		return Policy{}, ErrInvalid
	}
	timelock, err := time.ParseDuration(cfg.Policy.Timelock)
	if err != nil {
		return Policy{}, ErrInvalid
	}
	lifetime, err := time.ParseDuration(cfg.Policy.MaxLifetime)
	if err != nil {
		return Policy{}, ErrInvalid
	}
	emergency, err := time.ParseDuration(cfg.Policy.EmergencyMaxDuration)
	if err != nil {
		return Policy{}, ErrInvalid
	}
	return Policy{MinimumDeposit: cfg.Policy.MinimumDeposit, QuorumBPS: cfg.Policy.QuorumBPS, ThresholdBPS: cfg.Policy.ThresholdBPS, VotingPeriod: voting, Timelock: timelock, MaxLifetime: lifetime, EmergencyThreshold: cfg.Policy.EmergencyThreshold, EmergencyMaxDuration: emergency, ParameterRules: cfg.Policy.ParameterRules, GenesisRoleManifestHash: cfg.Policy.GenesisRoleManifestHash, ElectorateApprovalThreshold: cfg.Policy.ElectorateApprovalThreshold}, nil
}

func ValidateRuntimeConfig(cfg RuntimeConfig) (Policy, []byte, error) {
	if cfg.SchemaVersion != "ynx-governanced-config/v1" {
		return Policy{}, nil, fmt.Errorf("%w: unsupported runtime config version", ErrInvalid)
	}
	host, _, err := net.SplitHostPort(cfg.HTTPAddress)
	if err != nil {
		return Policy{}, nil, ErrInvalid
	}
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return Policy{}, nil, fmt.Errorf("%w: governance daemon must bind to loopback", ErrForbidden)
	}
	for _, path := range []string{cfg.StatePath, cfg.GatewayKeyPath} {
		if !filepath.IsAbs(path) || filepath.Clean(path) == string(filepath.Separator) {
			return Policy{}, nil, ErrInvalid
		}
	}
	policy, err := cfg.PolicyValue()
	if err != nil {
		return Policy{}, nil, err
	}
	if _, err = NewService(policy); err != nil {
		return Policy{}, nil, err
	}
	manifestHash, err := GenesisRoleManifestHash(cfg.GenesisRoles)
	if err != nil || !strings.EqualFold(manifestHash, policy.GenesisRoleManifestHash) {
		return Policy{}, nil, fmt.Errorf("%w: configured genesis roles do not match pinned hash", ErrForbidden)
	}
	info, err := os.Stat(cfg.GatewayKeyPath)
	if err != nil {
		return Policy{}, nil, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return Policy{}, nil, fmt.Errorf("%w: gateway key file must be regular and mode 0600", ErrForbidden)
	}
	raw, err := os.ReadFile(cfg.GatewayKeyPath)
	if err != nil {
		return Policy{}, nil, err
	}
	key, err := hex.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil || len(key) < 32 {
		return Policy{}, nil, fmt.Errorf("%w: gateway key must contain at least 32 bytes of hex", ErrInvalid)
	}
	return policy, key, nil
}

func OpenRuntime(cfg RuntimeConfig, now time.Time) (*Service, *GatewayAssertionAuthenticator, error) {
	policy, key, err := ValidateRuntimeConfig(cfg)
	if err != nil {
		return nil, nil, err
	}
	var service *Service
	if _, statErr := os.Stat(cfg.StatePath); statErr == nil {
		service, err = Load(cfg.StatePath)
		if err != nil {
			return nil, nil, err
		}
		if !reflect.DeepEqual(service.policy, policy) {
			return nil, nil, fmt.Errorf("%w: persisted policy differs from runtime config", ErrForbidden)
		}
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return nil, nil, statErr
	} else {
		service, err = NewService(policy)
		if err != nil {
			return nil, nil, err
		}
		if _, err = service.BootstrapRoles(cfg.GenesisRoles, policy.GenesisRoleManifestHash, now); err != nil {
			return nil, nil, err
		}
		if err = service.Save(cfg.StatePath, now); err != nil {
			return nil, nil, err
		}
	}
	auth, err := NewGatewayAssertionAuthenticator(key, service.ActiveEntitlements, time.Now)
	if err != nil {
		return nil, nil, err
	}
	return service, auth, nil
}
