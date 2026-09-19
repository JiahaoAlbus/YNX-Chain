// Package brokerage is Finance's off-chain securities boundary. It never uses
// YNXT balances as broker cash and never selects a live or personal Trading API.
package brokerage

import "strings"

const BrokerOrigin = "https://broker-api.sandbox.alpaca.markets"
const TokenURL = "https://authx.sandbox.alpaca.markets/v1/oauth2/token"
const Provider = "alpaca_broker"

// Fields are private to prevent accidental credential serialization/logging.
type Config struct {
	enabled               bool
	authMode, key, secret string
	issues                []string
}

func (Config) String() string   { return "Finance broker config [REDACTED]" }
func (Config) GoString() string { return "Finance broker config [REDACTED]" }

type Status struct {
	Provider                string   `json:"provider"`
	ChainEnvironment        string   `json:"chainEnvironment"`
	TradingEnvironment      string   `json:"tradingEnvironment"`
	Enabled                 bool     `json:"enabled"`
	State                   string   `json:"state"`
	Diagnostics             []string `json:"diagnostics"`
	SubmissionEnabled       bool     `json:"submissionEnabled"`
	OfficialSandboxVerified bool     `json:"officialSandboxVerified"`
	ProductionApproved      bool     `json:"productionApproved"`
}

// LoadConfig reads named server-side variables only. Missing or unsafe broker
// config disables this module; it does not prevent the original Finance startup.
func LoadConfig(get func(string) string) Config {
	c := Config{issues: []string{}}
	value := func(name, fallback string) string {
		v := get(name)
		if v == "" {
			return fallback
		}
		return v
	}
	require := func(name, want string) {
		if value(name, want) != want {
			c.issues = append(c.issues, name+":UNSUPPORTED_VALUE")
		}
	}
	require("YNX_CHAIN_ENV", "testnet")
	require("YNX_EVM_CHAIN_ID", "6423")
	require("FINANCE_TRADING_ENV", "sandbox")
	require("FINANCE_BROKER_PROVIDER", Provider)
	require("FINANCE_LIVE_ENABLED", "false")
	require("ALPACA_BROKER_SANDBOX_BASE_URL", BrokerOrigin)
	require("ALPACA_BROKER_TOKEN_URL", TokenURL)
	flag := value("FINANCE_TRADING_ENABLED", "false")
	c.enabled = flag == "true"
	if flag != "true" && flag != "false" {
		c.issues = append(c.issues, "FINANCE_TRADING_ENABLED:INVALID_BOOLEAN")
	}
	// Writes remain closed even if an operator sets this prematurely.
	if value("FINANCE_SANDBOX_WRITES_ENABLED", "false") != "false" {
		c.issues = append(c.issues, "SANDBOX_WRITE_APPROVAL_INTEGRATION_REQUIRED")
	}
	if get("ALPACA_BROKER_ACCOUNT_ID") != "" {
		c.issues = append(c.issues, "GLOBAL_ACCOUNT_MAPPING_FORBIDDEN")
	}
	c.authMode = value("ALPACA_BROKER_AUTH_MODE", "client_credentials")
	switch c.authMode {
	case "client_credentials":
		c.key = get("ALPACA_BROKER_CLIENT_ID")
		c.secret = get("ALPACA_BROKER_CLIENT_SECRET")
	case "legacy_basic":
		c.key = get("ALPACA_BROKER_API_KEY")
		c.secret = get("ALPACA_BROKER_API_SECRET")
	default:
		c.issues = append(c.issues, "AUTH_MODE_UNSUPPORTED")
	}
	if strings.TrimSpace(c.key) == "" || strings.TrimSpace(c.secret) == "" {
		c.issues = append(c.issues, "BLOCKED_CREDENTIALS")
	}
	if len(c.key) > 4096 || len(c.secret) > 8192 || strings.ContainsAny(c.key+c.secret, "\r\n\x00") || (c.authMode == "legacy_basic" && strings.Contains(c.key, ":")) {
		c.issues = append(c.issues, "CREDENTIAL_FORMAT_INVALID")
	}
	return c
}
func (c Config) Status() Status {
	state := "DISABLED"
	if c.enabled {
		state = "CONFIGURED_NOT_VERIFIED"
		if len(c.issues) > 0 {
			state = "NOT_CONFIGURED"
		}
	}
	for _, issue := range c.issues {
		if issue != "BLOCKED_CREDENTIALS" {
			state = "CONFIGURATION_REJECTED"
			break
		}
	}
	return Status{Provider: Provider, ChainEnvironment: "testnet", TradingEnvironment: "sandbox", Enabled: c.enabled, State: state, Diagnostics: append([]string{}, c.issues...)}
}
func (c Config) ready() bool { return c.enabled && len(c.issues) == 0 }
