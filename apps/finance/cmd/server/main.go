package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/finance"
	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
)

var buildCommit = "unknown"
var buildRelease = "local"
var buildTime = "unknown"

func main() {
	store, err := finance.OpenStoreWithDatabase(required("YNX_FINANCE_STATE_PATH"), os.Getenv("YNX_FINANCE_DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	upstreams, err := finance.NewUpstreams(required("YNX_EXPLORER_URL"), os.Getenv("YNX_PAY_URL"), os.Getenv("YNX_PAY_API_KEY"), required("YNX_FINANCE_DISPUTE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	if err := upstreams.ConfigureReadSourceActions(finance.ReadSourceActionConfig{
		ExchangeURL:  os.Getenv("YNX_FINANCE_EXCHANGE_ACTION_URL"),
		DEXURL:       os.Getenv("YNX_FINANCE_DEX_ACTION_URL"),
		QuantURL:     os.Getenv("YNX_FINANCE_QUANT_ACTION_URL"),
		EconomicsURL: os.Getenv("YNX_FINANCE_ECONOMICS_ACTION_URL"),
	}); err != nil {
		log.Fatal(err)
	}
	if err := upstreams.ConfigureReadSourceIntegrations(finance.ReadSourceIntegrationConfig{
		ExchangeURL: os.Getenv("YNX_FINANCE_EXCHANGE_READ_URL"),
		ExchangeKey: os.Getenv("YNX_FINANCE_EXCHANGE_READ_KEY"),
		DEXURL:      os.Getenv("YNX_FINANCE_DEX_READ_URL"),
		DEXKey:      os.Getenv("YNX_FINANCE_DEX_READ_KEY"),
		QuantURL:    os.Getenv("YNX_FINANCE_QUANT_READ_URL"),
		QuantKey:    os.Getenv("YNX_FINANCE_QUANT_READ_KEY"),
	}); err != nil {
		log.Fatal(err)
	}
	// New Web builds use a separate v2 authority, never migrate legacy identity
	// records or silently forward old proofs to the new Wallet service.
	var auth *finance.Authenticator
	var endpointAuthority finance.EndpointAuthorityGate
	legacyGateway := ""
	switch envDefault("YNX_FINANCE_AUTH_MODE", "product-session-v2") {
	case "product-session-v2":
		endpointAuthority, err = finance.NewNodeEndpointAuthority(finance.NodeEndpointAuthorityConfig{
			NodeBinary: os.Getenv("YNX_FINANCE_ENDPOINT_AUTHORITY_V2_NODE_BINARY"), Script: os.Getenv("YNX_FINANCE_ENDPOINT_AUTHORITY_V2_SCRIPT"),
			TrustRootFile: os.Getenv("YNX_FINANCE_ENDPOINT_AUTHORITY_V2_TRUST_ROOT_FILE"), ManifestFile: os.Getenv("YNX_FINANCE_ENDPOINT_AUTHORITY_V2_MANIFEST_FILE"),
			CheckpointFile: os.Getenv("YNX_FINANCE_ENDPOINT_AUTHORITY_V2_CHECKPOINT_FILE"), TrustedTimeFile: os.Getenv("YNX_FINANCE_ENDPOINT_AUTHORITY_V2_TRUSTED_TIME_FILE"), Timeout: 3 * time.Second,
		})
		if err == nil {
			auth, err = finance.NewBrowserV2AuthenticatorWithAuthority(endpointAuthority)
		}
	case "legacy-v1":
		legacyGateway = required("YNX_FINANCE_WALLET_GATEWAY_URL")
		if strings.TrimRight(legacyGateway, "/") == finance.BrowserWalletAuthority {
			log.Fatal("Legacy authority cannot be replaced with the new browser v2 authority")
		}
		auth, err = finance.NewAuthenticator(legacyGateway, required("YNX_FINANCE_INTERNAL_KEY"), "ynx-finance-v1", "com.ynxweb4.finance")
	default:
		log.Fatal("YNX_FINANCE_AUTH_MODE must be product-session-v2 or explicitly isolated legacy-v1")
	}
	if err != nil {
		log.Fatal(err)
	}
	service := &finance.Service{Store: store, Upstreams: upstreams, AI: &finance.HTTPAIProvider{URL: os.Getenv("YNX_AI_GATEWAY_URL"), APIKey: os.Getenv("YNX_AI_GATEWAY_KEY")}, Support: finance.SupportLinks{HelpURL: required("YNX_FINANCE_HELP_URL"), PrivacyURL: required("YNX_FINANCE_PRIVACY_URL"), DisputeURL: required("YNX_FINANCE_DISPUTE_URL")}}
	webDir := os.Getenv("YNX_FINANCE_WEB_DIR")
	if webDir == "" {
		webDir = "apps/finance/web"
	}
	var browserAuthority finance.EndpointAuthorityBrowserConfigProvider
	if provider, ok := endpointAuthority.(finance.EndpointAuthorityBrowserConfigProvider); ok {
		browserAuthority = provider
	}
	var evmLogin finance.EVMLoginAuthority
	loginNode, loginScript := os.Getenv("YNX_FINANCE_EVM_LOGIN_NODE_BINARY"), os.Getenv("YNX_FINANCE_EVM_LOGIN_SCRIPT")
	if loginNode != "" || loginScript != "" {
		evmLogin, err = finance.NewNodeEVMLoginAuthority(loginNode, loginScript, 5*time.Second)
		if err != nil {
			log.Fatal(err)
		}
	}
	var evmRead *finance.NodeEVMReadAuthority
	readNode, readScript := os.Getenv("YNX_FINANCE_EVM_READ_NODE_BINARY"), os.Getenv("YNX_FINANCE_EVM_READ_SCRIPT")
	if readNode != "" || readScript != "" {
		evmRead, err = finance.NewNodeEVMReadAuthority(readNode, readScript, 5*time.Second)
		if err != nil {
			log.Fatal(err)
		}
	}
	var evmSubject *finance.NodeEVMReadAuthority
	subjectNode, subjectScript := os.Getenv("YNX_FINANCE_EVM_SUBJECT_NODE_BINARY"), os.Getenv("YNX_FINANCE_EVM_SUBJECT_SCRIPT")
	if subjectNode != "" || subjectScript != "" {
		evmSubject, err = finance.NewNodeEVMReadAuthority(subjectNode, subjectScript, 5*time.Second)
		if err != nil {
			log.Fatal(err)
		}
	}
	var brokerOpaque *finance.NodeEVMReadAuthority
	opaqueNode, opaqueScript := os.Getenv("YNX_FINANCE_ORDER_OPAQUE_NODE_BINARY"), os.Getenv("YNX_FINANCE_ORDER_OPAQUE_SCRIPT")
	if opaqueNode != "" || opaqueScript != "" {
		brokerOpaque, err = finance.NewNodeEVMReadAuthority(opaqueNode, opaqueScript, 5*time.Second)
		if err != nil {
			log.Fatal(err)
		}
	}
	var opaqueCutover time.Time
	if raw := os.Getenv("YNX_FINANCE_ORDER_OPAQUE_LEGACY_CUTOVER_AT"); raw != "" {
		opaqueCutover, err = time.Parse(time.RFC3339Nano, raw)
		if err != nil || !strings.HasSuffix(raw, "Z") || opaqueCutover.IsZero() {
			log.Fatal("invalid Finance opaque legacy cutover")
		}
	}
	server, err := finance.NewServer(service, auth, finance.ServerConfig{BrokerConfig: brokerage.LoadConfig(os.Getenv), BrokerMaxFeeUSD: os.Getenv("YNX_FINANCE_BROKER_MAX_FEE_USD"), BrokerFeeBoundSource: os.Getenv("YNX_FINANCE_BROKER_FEE_BOUND_SOURCE"), BrokerFeeEvidenceRef: os.Getenv("YNX_FINANCE_BROKER_FEE_EVIDENCE_REF"), AllowedOrigins: split(envDefault("YNX_FINANCE_ALLOWED_ORIGINS", finance.BrowserFinanceOrigin)), WebDir: webDir, CursorSigningKey: required("YNX_FINANCE_CURSOR_SIGNING_KEY"), OperationsKey: required("YNX_FINANCE_OPERATIONS_KEY"), WalletGatewayURL: legacyGateway, EndpointAuthority: browserAuthority, EVMLoginAuthority: evmLogin, EVMReadAuthority: evmRead, EVMSubjectAuthority: evmSubject, BrokerOpaqueAuthority: brokerOpaque, BrokerOpaqueLegacyCutoverAt: opaqueCutover, LogWriter: os.Stdout, Build: buildinfo.Info{Commit: buildCommit, Release: buildRelease, BuildTime: buildTime}})
	if err != nil {
		log.Fatal(err)
	}
	httpServer := &http.Server{Addr: envDefault("YNX_FINANCE_LISTEN", "127.0.0.1:6436"), Handler: server.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 45 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("YNX Finance listening on %s", httpServer.Addr)
	signalContext, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	timeout, err := shutdownTimeout(os.Getenv("YNX_FINANCE_SHUTDOWN_TIMEOUT_SECONDS"))
	if err != nil {
		log.Fatal(err)
	}
	if err := serveUntilShutdown(signalContext, httpServer, server.BeginDrain, timeout); err != nil {
		log.Fatal(err)
	}
}

type httpLifecycle interface {
	ListenAndServe() error
	Shutdown(context.Context) error
	Close() error
}

func serveUntilShutdown(ctx context.Context, server httpLifecycle, beginDrain func() finance.DrainSnapshot, timeout time.Duration) error {
	if timeout <= 0 {
		return errors.New("Finance shutdown timeout must be positive")
	}
	serveResult := make(chan error, 1)
	go func() { serveResult <- server.ListenAndServe() }()
	select {
	case err := <-serveResult:
		if err == nil || errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		snapshot := beginDrain()
		log.Printf("YNX Finance drain started activeRequests=%d", snapshot.ActiveRequests)
	}
	shutdownContext, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		_ = server.Close()
		select {
		case <-serveResult:
		case <-time.After(time.Second):
		}
		return errors.New("Finance graceful shutdown timed out: " + err.Error())
	}
	select {
	case err := <-serveResult:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-time.After(time.Second):
		_ = server.Close()
		return errors.New("Finance listener did not stop after graceful shutdown")
	}
}

func shutdownTimeout(raw string) (time.Duration, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 30 * time.Second, nil
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds < 1 || seconds > 300 {
		return 0, errors.New("YNX_FINANCE_SHUTDOWN_TIMEOUT_SECONDS must be an integer from 1 to 300")
	}
	return time.Duration(seconds) * time.Second, nil
}

func required(key string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		log.Fatalf("%s is required", key)
	}
	return value
}
func envDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
func split(value string) []string {
	out := []string{}
	for _, part := range strings.Split(value, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}
