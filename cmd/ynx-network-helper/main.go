// ynx-network-helper serves the Network PWA on an OS-owned loopback listener.
package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"os/user"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/nativeconsent"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/receipt"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/resourceauthority"
	networkweb "github.com/JiahaoAlbus/YNX-Chain/apps/network/web"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

const ticketLife = 15 * time.Minute
const serviceVersion = "V5-NETWORK-SERVICE/0.3-qa"

var sourceRevision = "unrecorded-development-source"

var txPattern = regexp.MustCompile(`^(0x)?[a-fA-F0-9]{64}$`)

type helper struct {
	mu                                             sync.Mutex
	origin, host, uid, bootCode, challenge, ticket string
	challengeUntil, ticketUntil                    time.Time
	ticketContext                                  context.Context
	ticketCancel                                   context.CancelFunc
	attempts                                       int
	anchor                                         *receipt.TrustAnchor
	pqCommand                                      *receipt.PQCommandVerifier
	history                                        *receipt.History
	receipts                                       *receipt.ReceiptStore
	ipcDirectory                                   string
	historyContextPin                              string
	resourceState                                  string
	rpc                                            string
	client                                         *http.Client
	now                                            func() time.Time
}

func randomToken() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func newHelper(origin, uid, code, rpc string, anchor *receipt.TrustAnchor) *helper {
	u, _ := url.Parse(origin)
	return &helper{origin: origin, host: u.Host, uid: uid, bootCode: code, rpc: strings.TrimRight(rpc, "/"), anchor: anchor, resourceState: "disabled", now: time.Now, client: &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect refused") }}}
}
func sendJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func denied(w http.ResponseWriter, status int, code string) {
	sendJSON(w, status, map[string]string{"error": code})
}
func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
		denied(w, 415, "JSON_REQUIRED")
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(value); err != nil {
		denied(w, 400, "INVALID_JSON")
		return false
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		denied(w, 400, "INVALID_JSON")
		return false
	}
	return true
}
func (h *helper) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
	if r.Host != h.host {
		denied(w, 403, "HOST_DENIED")
		return
	}
	remote, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || net.ParseIP(remote) == nil || !net.ParseIP(remote).IsLoopback() {
		denied(w, 403, "LOOPBACK_REQUIRED")
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			denied(w, 405, "METHOD_DENIED")
			return
		}
		networkweb.Handler().ServeHTTP(w, r)
		return
	}
	if r.Method != http.MethodPost {
		denied(w, 405, "POST_REQUIRED")
		return
	}
	if r.Header.Get("Origin") != h.origin {
		denied(w, 403, "ORIGIN_DENIED")
		return
	}
	switch r.URL.Path {
	case "/api/pair/challenge":
		h.mu.Lock()
		defer h.mu.Unlock()
		if h.bootCode == "" || h.attempts >= 5 {
			denied(w, 403, "RESTART_TO_PAIR")
			return
		}
		h.challenge = randomToken()
		h.challengeUntil = h.now().Add(time.Minute)
		sendJSON(w, 200, map[string]any{"challenge": h.challenge, "expires": h.challengeUntil.UTC().Format(time.RFC3339), "approval": "Enter the one-use code shown by your local helper"})
	case "/api/pair":
		var in struct {
			Challenge string `json:"challenge"`
			Code      string `json:"code"`
		}
		if !decode(w, r, &in) {
			return
		}
		h.mu.Lock()
		defer h.mu.Unlock()
		challenge := h.challenge
		h.challenge = "" // Every approval attempt consumes its challenge.
		if h.bootCode == "" || h.attempts >= 5 || challenge == "" || !h.now().Before(h.challengeUntil) || subtle.ConstantTimeCompare([]byte(in.Challenge), []byte(challenge)) != 1 {
			denied(w, 403, "CHALLENGE_DENIED")
			return
		}
		h.attempts++
		if subtle.ConstantTimeCompare([]byte(in.Code), []byte(h.bootCode)) != 1 {
			denied(w, 403, "APPROVAL_DENIED")
			return
		}
		h.bootCode = ""
		h.ticket = randomToken()
		h.ticketUntil = h.now().Add(ticketLife)
		h.ticketContext, h.ticketCancel = context.WithDeadline(context.Background(), h.ticketUntil)
		sendJSON(w, 200, map[string]any{"ticket": h.ticket, "expires": h.ticketUntil.UTC().Format(time.RFC3339), "origin": h.origin, "scope": []string{"receipt.read", "receipt.verify", "node.read", "native.status"}})
	default:
		ctx, release, ok := h.authorizedContext(r)
		if !ok {
			denied(w, 401, "PAIRING_REQUIRED")
			return
		}
		defer release()
		r = r.WithContext(ctx)
		switch r.URL.Path {
		case "/api/status":
			sendJSON(w, 200, map[string]any{"version": serviceVersion, "sourceRevision": sourceRevision, "paired": true, "anchorConfigured": h.anchor != nil, "checkpoint": h.anchor.Summary(), "helperOsUid": h.uid, "callerOsIdentityVerified": false, "assurance": "local-code-origin-ticket", "pqIndependentTrustConfigured": h.pqCommand != nil, "contribution": h.resourceState, "managedNodes": 0, "rpc": h.rpc})
		case "/api/revoke":
			h.mu.Lock()
			h.ticket = ""
			h.ticketCancel()
			h.mu.Unlock()
			sendJSON(w, 200, map[string]bool{"revoked": true})
		case "/api/verify":
			h.verify(w, r)
		case "/api/lookup":
			h.lookup(w, r)
		case "/api/lookup-proof":
			h.lookupProof(w, r)
		case "/api/node-report":
			h.nodeReport(w, r)
		case "/api/client-receipt":
			h.clientReceipt(w, r)
		case "/api/receipts":
			h.listReceipts(w, r)
		case "/api/receipt":
			h.getReceipt(w, r)
		case "/api/native-status":
			h.nativeStatus(w, r)
		case "/api/history":
			if h.history == nil {
				denied(w, 503, "HISTORY_NOT_CONFIGURED")
				return
			}
			h.sendAuthorizedJSON(w, r, map[string]any{"classification": "historical-local-projection", "authority": false, "observations": h.history.List()})
		default:
			denied(w, 404, "UNSUPPORTED")
		}
	}
}
func (h *helper) authorizedContext(r *http.Request) (context.Context, func(), bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if h.ticket == "" || !h.now().Before(h.ticketUntil) || h.ticketContext == nil || h.ticketContext.Err() != nil || subtle.ConstantTimeCompare([]byte(got), []byte(h.ticket)) != 1 {
		return nil, nil, false
	}
	ctx, cancel := context.WithCancel(r.Context())
	stop := context.AfterFunc(h.ticketContext, cancel)
	return ctx, func() { stop(); cancel() }, true
}

// Serialize the response boundary with revoke. Offline proof verification has
// no cancellation API; it may finish computation but cannot publish a result
// under an expired/revoked ticket. HTTP transport observes the request context.
func (h *helper) sendAuthorizedJSON(w http.ResponseWriter, r *http.Request, value any) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r.Context().Err() != nil || h.ticket == "" || !h.now().Before(h.ticketUntil) || h.ticketContext.Err() != nil {
		denied(w, 401, "PAIRING_REQUIRED")
		return
	}
	if record, ok := value.(receipt.ClientReceipt); ok {
		var err error
		record, err = h.receipts.Save(record)
		if err != nil {
			denied(w, 503, "RECEIPT_WRITE_FAILED")
			return
		}
		value = record
	}
	if view, ok := receiptObservation(value); ok && h.history != nil {
		if err := h.history.Observe(view, h.historyContextPin); err != nil {
			denied(w, 503, "HISTORY_WRITE_FAILED")
			return
		}
	}
	// A durable write may straddle expiry. Retain that historical computation,
	// but never publish it as a current response under an expired ticket.
	if r.Context().Err() != nil || !h.now().Before(h.ticketUntil) || h.ticketContext.Err() != nil {
		denied(w, 401, "PAIRING_REQUIRED")
		return
	}
	sendJSON(w, 200, value)
}

func receiptObservation(value any) (receipt.ProofView, bool) {
	switch v := value.(type) {
	case receipt.ProofView:
		return v, true
	case receipt.PQProofView:
		return v.ProofView, true
	case receipt.ClientReceipt:
		var view receipt.ProofView
		if json.Unmarshal(v.View, &view) == nil {
			return view, true
		}
	case map[string]any:
		return receiptObservation(v["view"])
	}
	return receipt.ProofView{}, false
}
func (h *helper) verify(w http.ResponseWriter, r *http.Request) {
	var in struct {
		TxID  string          `json:"txId"`
		Proof json.RawMessage `json:"proof"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !txPattern.MatchString(in.TxID) {
		denied(w, 400, "INVALID_TX_ID")
		return
	}
	var format struct {
		Version string `json:"version"`
	}
	if json.Unmarshal(in.Proof, &format) == nil && format.Version == "YNX-PQ-RPC-TRANSACTION-PROOF/v1" {
		// The collector's independentFinality/verification fields never supply
		// local trust. A pinned original host context is not yet configured for
		// this public-receipt helper; do not convert a PQ proof to classic keys.
		if h.pqCommand != nil {
			h.sendAuthorizedJSON(w, r, h.pqCommand.Verify(r.Context(), in.TxID, in.Proof))
			return
		}
		h.sendAuthorizedJSON(w, r, receipt.VerifyPQNetworkReceipt(in.TxID, nil, in.Proof, h.now()))
		return
	}
	var proof receipt.ChainProof
	if err := cmtjson.Unmarshal(in.Proof, &proof); err != nil {
		denied(w, 400, "INVALID_PROOF")
		return
	}
	h.sendAuthorizedJSON(w, r, receipt.VerifyNetworkReceipt(in.TxID, h.anchor, proof, h.now()))
}
func (h *helper) lookup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		TxID string `json:"txId"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !txPattern.MatchString(in.TxID) {
		denied(w, 400, "INVALID_TX_ID")
		return
	}
	endpoint := h.rpc + "/txs/" + url.PathEscape(in.TxID)
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, endpoint, nil)
	if err != nil {
		denied(w, 502, "RPC_UNAVAILABLE")
		return
	}
	response, err := h.client.Do(request)
	if err != nil {
		if r.Context().Err() != nil {
			denied(w, 401, "PAIRING_REQUIRED")
			return
		}
		denied(w, 502, "RPC_UNAVAILABLE")
		return
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	if r.Context().Err() != nil {
		denied(w, 401, "PAIRING_REQUIRED")
		return
	}
	if err != nil || len(raw) > 2<<20 {
		denied(w, 502, "RPC_RESPONSE_LIMIT")
		return
	}
	if response.StatusCode != http.StatusOK {
		sendJSON(w, 502, map[string]any{"error": "RPC_HTTP_ERROR", "upstreamStatus": response.StatusCode})
		return
	}
	if !json.Valid(raw) {
		denied(w, 502, "RPC_INVALID_JSON")
		return
	}
	h.sendAuthorizedJSON(w, r, map[string]any{"view": receipt.VerifyNetworkReceipt(in.TxID, nil, receipt.ChainProof{Source: endpoint}, h.now()), "report": json.RawMessage(raw), "reportedBy": endpoint})
}
func validRPC(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("rpc must be an origin/path without credentials, query, or fragment")
	}
	if u.Scheme != "https" {
		ip := net.ParseIP(u.Hostname())
		if u.Scheme != "http" || ip == nil || !ip.IsLoopback() {
			return errors.New("rpc must use HTTPS (HTTP only for numeric loopback)")
		}
	}
	return nil
}
func run() (runErr error) {
	listen := flag.String("listen", "127.0.0.1:0", "numeric loopback listener; port 0 chooses a free port")
	rpc := flag.String("rpc", "https://rpc.ynxweb4.com", "fixed read-only REST source")
	anchorFile := flag.String("anchor", "", "independently obtained checkpoint document")
	anchorPin := flag.String("anchor-pin", "", "SHA-256 document pin obtained independently of queried RPC")
	anchorSource := flag.String("anchor-source", "", "human-readable independent checkpoint source")
	pqExecutable := flag.String("pq-verifier", "", "original CORE verifier executable; never supplied by HTTP")
	pqExecutablePin := flag.String("pq-verifier-sha256", "", "independent exact executable digest")
	pqContext := flag.String("pq-context", "", "original independent public transaction trust context")
	pqContextPin := flag.String("pq-context-sha256", "", "independent exact context digest")
	dataDir := flag.String("data-dir", "", "private Network product directory; defaults to user config/YNXNetwork")
	nativeStatus := flag.Bool("native-status", false, "query running helper through kernel-authenticated local IPC, then exit")
	nativeCall := flag.Bool("native-call", false, "read one bounded structured native IPC request from stdin and print its response")
	showVersion := flag.Bool("version", false, "print service version and exact recorded source, then exit")
	participationConfig := flag.String("participation-config", "", "independently configured network identity for native participation")
	participationPin := flag.String("participation-config-sha256", "", "exact independent network configuration digest")
	governanceRPC := flag.String("governance-rpc", "", "fixed governance read source; defaults to configured chain RPC")
	nativeLocale := flag.String("native-ui-locale", "zh-Hans", "native local consent language enum; no authority")
	nativeTheme := flag.String("native-ui-theme", "light", "native local consent theme enum; no authority")
	controlledPacket := flag.String("run-controlled-wasm", "", "explicit controlled public-block QA packet; never production authority")
	controlledIssuerPin := flag.String("controlled-issuer-key-sha256", "", "independent controlled fixture issuer public-key pin")
	controlledConsentPin := flag.String("controlled-consent-key-sha256", "", "independent controlled fixture consent public-key pin")
	flag.Parse()
	if !nativeconsent.Locale(*nativeLocale) || !nativeconsent.Theme(*nativeTheme) {
		return errors.New("unsupported native appearance enum")
	}
	if *controlledPacket != "" || *controlledIssuerPin != "" || *controlledConsentPin != "" {
		if *controlledPacket == "" || *controlledIssuerPin == "" || *controlledConsentPin == "" || *nativeStatus || *nativeCall || *showVersion || *anchorFile != "" || *pqExecutable != "" || *pqContext != "" || *participationConfig != "" {
			return errors.New("controlled WASM QA requires its packet, two independent key pins and explicit data directory only")
		}
		allowedFlags := map[string]bool{"run-controlled-wasm": true, "controlled-issuer-key-sha256": true, "controlled-consent-key-sha256": true, "data-dir": true}
		extra := false
		flag.Visit(func(f *flag.Flag) {
			if !allowedFlags[f.Name] {
				extra = true
			}
		})
		if extra || flag.NArg() != 0 {
			return errors.New("unrelated helper option with controlled WASM QA")
		}
		return runControlledWASM(*controlledPacket, *dataDir, *controlledIssuerPin, *controlledConsentPin)
	}

	if *showVersion {
		fmt.Printf("%s %s\n", serviceVersion, sourceRevision)
		return nil
	}
	host, _, err := net.SplitHostPort(*listen)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		return errors.New("listen must be numeric loopback")
	}
	if err = validRPC(*rpc); err != nil {
		return err
	}
	if *dataDir == "" {
		base, err := os.UserConfigDir()
		if err != nil {
			return err
		}
		*dataDir = filepath.Join(base, "YNXNetwork")
	}
	ipcDir := filepath.Join(*dataDir, "ipc")
	if *nativeStatus || *nativeCall {
		request := localipc.Request{Version: localipc.Version, ID: randomToken(), Operation: "status"}
		if *nativeCall {
			if *nativeStatus {
				return errors.New("choose one native client entry")
			}
			raw, err := io.ReadAll(io.LimitReader(os.Stdin, localipc.MaxMessageBytes+1))
			if err != nil || len(raw) > localipc.MaxMessageBytes {
				return errors.New("bounded native request required")
			}
			if err := nativeDecode(raw, &request); err != nil {
				return err
			}
		}
		timeout := 5 * time.Second
		if budget := localipc.OperationTimeout(request.Operation); budget > 10*time.Second {
			timeout = budget
		}
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		result, err := localipc.Call(ctx, ipcDir, request)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(result)
	}
	history, err := receipt.OpenHistory(filepath.Join(*dataDir, "proof-history.json"))
	if err != nil {
		return fmt.Errorf("private Network history: %w", err)
	}
	defer func() { runErr = errors.Join(runErr, history.Close()) }()
	receipts, err := receipt.OpenReceiptStore(filepath.Join(*dataDir, "client-receipts.json"))
	if err != nil {
		return fmt.Errorf("private Network receipt store: %w", err)
	}
	defer func() { runErr = errors.Join(runErr, receipts.Close()) }()
	resource, err := contribution.NewDisabled(filepath.Join(*dataDir, "resource-journal.json"))
	if err != nil {
		log.Printf("Local resource capability unavailable; existing journal preserved: %v", err)
	}
	if resource != nil {
		defer func() { runErr = errors.Join(runErr, resource.Close()) }()
	}
	node, err := ownednode.New(ownednode.Config{Directory: filepath.Join(*dataDir, ownednode.DirectoryName)})
	if err != nil {
		log.Printf("Owned node capability unavailable; existing state preserved: %v", err)
	}
	if node != nil {
		defer func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			runErr = errors.Join(runErr, node.Close(ctx))
		}()
	}
	if *governanceRPC == "" {
		*governanceRPC = *rpc
	}
	participationService, err := openParticipationConfig(*participationConfig, *participationPin, *governanceRPC, *rpc, *dataDir)
	if err != nil {
		return fmt.Errorf("native participation configuration: %w", err)
	}
	if participationService != nil {
		defer func() { runErr = errors.Join(runErr, participationService.Close()) }()
	}
	var pqVerifier *receipt.PQCommandVerifier
	if *pqExecutable != "" || *pqExecutablePin != "" || *pqContext != "" || *pqContextPin != "" {
		pqVerifier, err = receipt.OpenPQCommandVerifier(*pqExecutable, *pqExecutablePin, *pqContext, *pqContextPin)
		if err != nil {
			return fmt.Errorf("original PQ trust configuration refused: %w", err)
		}
		defer func() { runErr = errors.Join(runErr, pqVerifier.Close()) }()
	}
	var anchor *receipt.TrustAnchor
	if *anchorFile != "" {
		raw, err := os.ReadFile(*anchorFile)
		if err != nil {
			return err
		}
		anchor, err = receipt.ImportTrustAnchor(raw, *anchorPin, *anchorSource, time.Now())
		if err != nil {
			return fmt.Errorf("checkpoint refused: %w", err)
		}
	} else if *anchorPin != "" || *anchorSource != "" {
		return errors.New("anchor file, independent pin and source must be configured together")
	}
	current, err := user.Current()
	if err != nil {
		return fmt.Errorf("local OS identity unavailable: %w", err)
	}
	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		return err
	}
	defer listener.Close()
	serviceContext, stopService := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopService()
	sourceContext, cancelSource := context.WithTimeout(serviceContext, 3*time.Second)
	resourceSource := resourceauthority.Open(sourceContext)
	cancelSource()
	defer func() {
		// Preserve this same Native owner until physical drain, including
		// timeout/UNKNOWN. A later Close never reacquires Source or a nonce.
		reported := false
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			complete, err := resourceSource.Close(ctx)
			cancel()
			if complete {
				runErr = errors.Join(runErr, err)
				break
			}
			if !reported {
				log.Printf("Network resource Source physical drain pending; original owner retained")
				reported = true
			}
			time.Sleep(100 * time.Millisecond)
		}
	}()
	producer, err := openNativeConsent(*nativeLocale, *nativeTheme)
	if err != nil {
		log.Printf("Native visible consent unavailable; no node approval: %v", err)
	}
	var consent []nodeConsent
	if producer != nil {
		consent = append(consent, producer)
		defer func() { runErr = errors.Join(runErr, producer.Close()) }()
	}
	native, err := startNativeServiceWithSource(serviceContext, ipcDir, participationService, node, resource, resourceSource, consent...)
	if err != nil {
		return fmt.Errorf("native Network service: %w", err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		runErr = errors.Join(runErr, native.Close(ctx))
	}()
	origin := "http://" + listener.Addr().String()
	code := randomToken()
	h := newHelper(origin, current.Uid, code, *rpc, anchor)
	h.pqCommand = pqVerifier
	h.history = history
	h.receipts = receipts
	h.ipcDirectory = ipcDir
	if resource == nil {
		h.resourceState = "unavailable"
	}
	configDigest := sha256.Sum256([]byte(*anchorPin + ":" + *pqContextPin + ":" + *pqExecutablePin))
	h.historyContextPin = hex.EncodeToString(configDigest[:])
	fmt.Printf("YNX Network local helper\nOpen: %s\nOne-use pairing code: %s\nScope: receipt read/verify, node read, native status; expires after 15 minutes. Revoke in the app. Restart helper to pair again.\n", origin, code)
	server := &http.Server{Handler: h, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 45 * time.Second, MaxHeaderBytes: 16 << 10}
	shutdownDone := make(chan struct{})
	var shutdownErr error
	go func() {
		defer close(shutdownDone)
		<-serviceContext.Done()
		h.mu.Lock()
		h.ticket = ""
		if h.ticketCancel != nil {
			h.ticketCancel()
		}
		h.mu.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		shutdownErr = server.Shutdown(ctx)
	}()
	err = server.Serve(listener)
	stopService()
	<-shutdownDone
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		return errors.Join(err, shutdownErr)
	}
	return shutdownErr
}
func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
