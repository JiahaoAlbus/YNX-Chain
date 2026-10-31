// ynx-network-helper serves the Network PWA on an OS-owned loopback listener.
package main

import (
	"context"
	"crypto/rand"
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
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/receipt"
	networkweb "github.com/JiahaoAlbus/YNX-Chain/apps/network/web"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

const ticketLife = 15 * time.Minute

var txPattern = regexp.MustCompile(`^(0x)?[a-fA-F0-9]{64}$`)

type helper struct {
	mu                                             sync.Mutex
	origin, host, uid, bootCode, challenge, ticket string
	challengeUntil, ticketUntil                    time.Time
	attempts                                       int
	anchor                                         *receipt.TrustAnchor
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
	return &helper{origin: origin, host: u.Host, uid: uid, bootCode: code, rpc: strings.TrimRight(rpc, "/"), anchor: anchor, now: time.Now, client: &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect refused") }}}
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
		sendJSON(w, 200, map[string]any{"ticket": h.ticket, "expires": h.ticketUntil.UTC().Format(time.RFC3339), "origin": h.origin, "scope": []string{"receipt.read", "receipt.verify"}})
	default:
		if !h.authorized(r) {
			denied(w, 401, "PAIRING_REQUIRED")
			return
		}
		switch r.URL.Path {
		case "/api/status":
			sendJSON(w, 200, map[string]any{"paired": true, "anchorConfigured": h.anchor != nil, "checkpoint": h.anchor.Summary(), "osUid": h.uid, "contribution": "disabled", "managedNodes": 0, "rpc": h.rpc})
		case "/api/revoke":
			h.mu.Lock()
			h.ticket = ""
			h.mu.Unlock()
			sendJSON(w, 200, map[string]bool{"revoked": true})
		case "/api/verify":
			h.verify(w, r)
		case "/api/lookup":
			h.lookup(w, r)
		default:
			denied(w, 404, "UNSUPPORTED")
		}
	}
}
func (h *helper) authorized(r *http.Request) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	return h.ticket != "" && h.now().Before(h.ticketUntil) && subtle.ConstantTimeCompare([]byte(got), []byte(h.ticket)) == 1
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
	var proof receipt.ChainProof
	if err := cmtjson.Unmarshal(in.Proof, &proof); err != nil {
		denied(w, 400, "INVALID_PROOF")
		return
	}
	sendJSON(w, 200, receipt.VerifyNetworkReceipt(in.TxID, h.anchor, proof, h.now()))
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
		denied(w, 502, "RPC_UNAVAILABLE")
		return
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
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
	sendJSON(w, 200, map[string]any{"view": receipt.VerifyNetworkReceipt(in.TxID, nil, receipt.ChainProof{Source: endpoint}, h.now()), "report": json.RawMessage(raw), "reportedBy": endpoint})
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
func run() error {
	listen := flag.String("listen", "127.0.0.1:0", "numeric loopback listener; port 0 chooses a free port")
	rpc := flag.String("rpc", "https://rpc.ynxweb4.com", "fixed read-only REST source")
	anchorFile := flag.String("anchor", "", "independently obtained checkpoint document")
	anchorPin := flag.String("anchor-pin", "", "SHA-256 document pin obtained independently of queried RPC")
	anchorSource := flag.String("anchor-source", "", "human-readable independent checkpoint source")
	flag.Parse()
	host, _, err := net.SplitHostPort(*listen)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		return errors.New("listen must be numeric loopback")
	}
	if err = validRPC(*rpc); err != nil {
		return err
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
	origin := "http://" + listener.Addr().String()
	code := randomToken()
	h := newHelper(origin, current.Uid, code, *rpc, anchor)
	fmt.Printf("YNX Network local helper\nOpen: %s\nOne-use pairing code: %s\nScope: receipt read/verify only; expires after 15 minutes. Revoke in the app. Restart helper to pair again.\n", origin, code)
	server := &http.Server{Handler: h, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 45 * time.Second, MaxHeaderBytes: 16 << 10}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(stop)
	go func() {
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	if err = server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
