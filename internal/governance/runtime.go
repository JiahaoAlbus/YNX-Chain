package governance

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

type RuntimePolicyConfig struct {
	ChainID                     string                   `json:"chainId"`
	VoteDomain                  string                   `json:"voteDomain"`
	VoteReplacementPolicy       string                   `json:"voteReplacementPolicy"`
	VoteWithdrawalPolicy        string                   `json:"voteWithdrawalPolicy"`
	VoteMaxClockSkew            string                   `json:"voteMaxClockSkew"`
	MinimumDeposit              uint64                   `json:"minimumDeposit"`
	QuorumBPS                   uint64                   `json:"quorumBps"`
	ThresholdBPS                uint64                   `json:"thresholdBps"`
	VotingPeriod                string                   `json:"votingPeriod"`
	Timelock                    string                   `json:"timelock"`
	TimelockGrace               string                   `json:"timelockGrace"`
	MaxLifetime                 string                   `json:"maxLifetime"`
	EmergencyThreshold          uint64                   `json:"emergencyThreshold"`
	EmergencyMaxDuration        string                   `json:"emergencyMaxDuration"`
	ParameterRules              map[string]ParameterRule `json:"parameterRules"`
	GenesisRoleManifestHash     string                   `json:"genesisRoleManifestHash"`
	ElectorateApprovalThreshold uint64                   `json:"electorateApprovalThreshold"`
}

type RuntimeConfig struct {
	SchemaVersion  string                  `json:"schemaVersion"`
	HTTPAddress    string                  `json:"httpAddress"`
	StatePath      string                  `json:"statePath"`
	GatewayKeyPath string                  `json:"gatewayKeyPath"`
	Policy         RuntimePolicyConfig     `json:"policy"`
	GenesisRoles   []RoleAssignmentInput   `json:"genesisRoles"`
	ChainCore      *RuntimeChainCoreConfig `json:"chainCore,omitempty"`
}

type RuntimeChainCoreConfig struct {
	RPCURL          string `json:"rpcUrl"`
	ChainID         int64  `json:"chainId"`
	ExecutionSigner string `json:"executionSigner"`
	RequestTimeout  string `json:"requestTimeout"`
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
	voteClockSkew, err := time.ParseDuration(cfg.Policy.VoteMaxClockSkew)
	if err != nil {
		return Policy{}, ErrInvalid
	}
	voting, err := time.ParseDuration(cfg.Policy.VotingPeriod)
	if err != nil {
		return Policy{}, ErrInvalid
	}
	timelock, err := time.ParseDuration(cfg.Policy.Timelock)
	if err != nil {
		return Policy{}, ErrInvalid
	}
	timelockGrace, err := time.ParseDuration(cfg.Policy.TimelockGrace)
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
	return Policy{ChainID: cfg.Policy.ChainID, VoteDomain: cfg.Policy.VoteDomain, VoteReplacementPolicy: cfg.Policy.VoteReplacementPolicy, VoteWithdrawalPolicy: cfg.Policy.VoteWithdrawalPolicy, VoteMaxClockSkew: voteClockSkew, MinimumDeposit: cfg.Policy.MinimumDeposit, QuorumBPS: cfg.Policy.QuorumBPS, ThresholdBPS: cfg.Policy.ThresholdBPS, VotingPeriod: voting, Timelock: timelock, TimelockGrace: timelockGrace, MaxLifetime: lifetime, EmergencyThreshold: cfg.Policy.EmergencyThreshold, EmergencyMaxDuration: emergency, ParameterRules: cfg.Policy.ParameterRules, GenesisRoleManifestHash: cfg.Policy.GenesisRoleManifestHash, ElectorateApprovalThreshold: cfg.Policy.ElectorateApprovalThreshold}, nil
}

func ValidateRuntimeConfig(cfg RuntimeConfig) (Policy, []byte, error) {
	if cfg.SchemaVersion == "ynx-governanced-config/v1" {
		return Policy{}, nil, fmt.Errorf("%w: governance runtime config v1 requires signed-vote policy migration", ErrForbidden)
	}
	if cfg.SchemaVersion == "ynx-governanced-config/v2" {
		return Policy{}, nil, fmt.Errorf("%w: governance runtime config v2 requires explicit timelock-grace migration to v3", ErrForbidden)
	}
	if cfg.SchemaVersion != "ynx-governanced-config/v3" && cfg.SchemaVersion != "ynx-governanced-config/v4" {
		return Policy{}, nil, fmt.Errorf("%w: unsupported runtime config version", ErrInvalid)
	}
	if cfg.SchemaVersion == "ynx-governanced-config/v3" && cfg.ChainCore != nil {
		return Policy{}, nil, fmt.Errorf("%w: Chain Core execution config requires runtime config v4", ErrForbidden)
	}
	if cfg.SchemaVersion == "ynx-governanced-config/v4" {
		if _, err := validateRuntimeChainCoreConfig(cfg.ChainCore); err != nil {
			return Policy{}, nil, err
		}
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

func validateRuntimeChainCoreConfig(cfg *RuntimeChainCoreConfig) (time.Duration, error) {
	if cfg == nil || cfg.ChainID <= 0 || !consensus.IsNativeAddress(strings.TrimSpace(cfg.ExecutionSigner)) {
		return 0, fmt.Errorf("%w: runtime config v4 requires numeric Chain Core ID and canonical execution signer", ErrInvalid)
	}
	if _, err := validateCometRPCURL(cfg.RPCURL); err != nil {
		return 0, err
	}
	timeout, err := time.ParseDuration(cfg.RequestTimeout)
	if err != nil || timeout < time.Second || timeout > 30*time.Second {
		return 0, fmt.Errorf("%w: Chain Core request timeout must be between 1s and 30s", ErrInvalid)
	}
	return timeout, nil
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

func OpenIntegratedRuntime(cfg RuntimeConfig, now time.Time, httpClient *http.Client) (*Service, *GatewayAssertionAuthenticator, ChainExecutionOwner, error) {
	service, auth, err := OpenRuntime(cfg, now)
	if err != nil {
		return nil, nil, nil, err
	}
	if cfg.ChainCore == nil {
		return service, auth, nil, nil
	}
	timeout, err := validateRuntimeChainCoreConfig(cfg.ChainCore)
	if err != nil {
		return nil, nil, nil, err
	}
	client, err := NewCometChainExecutionClient(cfg.ChainCore.RPCURL, cfg.ChainCore.ChainID, timeout, httpClient)
	if err != nil {
		return nil, nil, nil, err
	}
	owner, err := NewCanonicalChainExecutionAdapter(cfg.ChainCore.ChainID, cfg.ChainCore.ExecutionSigner, client)
	if err != nil {
		return nil, nil, nil, err
	}
	return service, auth, owner, nil
}
