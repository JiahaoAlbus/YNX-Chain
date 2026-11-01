package commerce

import (
	"bufio"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"
)

// Explicit PUBLIC cross-owner software driver, not an installed Source. It
// copies an original frozen Shop state and consumes only actual Pay GETs.
// The old Core funds/sign/broadcast workflows are never invoked here.
func TestNativePayNotificationOriginalReadDriver(t *testing.T) {
	if os.Getenv("P07_PUBLIC_PAY_NOTIFICATION_DRIVER") != "1" {
		t.Skip("explicit PUBLIC P06 notification TLS/Shop original-read driver only")
	}
	type command struct {
		Command            string `json:"command"`
		SourcePath         string `json:"sourcePath"`
		SourceSHA256       string `json:"sourceSHA256"`
		OrderID            string `json:"orderId"`
		Origin             string `json:"origin"`
		CAPEM              string `json:"caPEM"`
		MerchantID         string `json:"merchantId"`
		SecretHex          string `json:"secretHex"`
		SecretVersion      int    `json:"secretVersion"`
		OriginalPUBLICHTTP bool   `json:"originalPUBLICHTTP"`
	}
	input := bufio.NewScanner(os.Stdin)
	input.Buffer(make([]byte, 4096), 1<<20)
	var store *Store
	var orderID, statePath, frozenPayOrigin string
	var cfg ServerConfig
	var tlsServer *httptest.Server
	var transport *http.Transport
	var current http.Handler
	var sequence int
	var gate sync.RWMutex
	var traceMu sync.Mutex
	reads := []string{}
	defer func() {
		if tlsServer != nil {
			tlsServer.Close()
		}
		if transport != nil {
			transport.CloseIdleConnections()
		}
	}()
	reply := func(value any) {
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		fmt.Fprintln(os.Stdout, "P07_NOTIFICATION_JSON "+string(raw))
	}
	for input.Scan() {
		var c command
		if json.Unmarshal(input.Bytes(), &c) != nil {
			t.Fatal("invalid bounded PUBLIC notification command")
		}
		sequence++
		result := map[string]any{"command": c.Command, "PUBLICSource": true, "SourceAdmission": false, "fundsSent": false}
		switch c.Command {
		case "init":
			if store != nil || !filepath.IsAbs(c.SourcePath) || !invoiceRecoveryID.MatchString(c.OrderID) || !invoiceRecoveryID.MatchString(c.MerchantID) || c.SecretVersion < 1 {
				t.Fatal("original PUBLIC init required")
			}
			raw, err := os.ReadFile(c.SourcePath)
			hash := sha256.Sum256(raw)
			if err != nil || hex.EncodeToString(hash[:]) != c.SourceSHA256 {
				t.Fatal("frozen original source bytes mismatch")
			}
			dir, err := os.MkdirTemp(filepath.Dir(os.Args[0]), "PUBLIC-notification-shop-original-")
			if err != nil {
				t.Fatal(err)
			}
			statePath = filepath.Join(dir, "original-shop.json")
			if err = os.WriteFile(statePath, raw, 0600); err != nil {
				t.Fatal(err)
			}
			store, err = Open(statePath)
			if err != nil {
				t.Fatal(err)
			}
			order, ok := store.s.Orders[c.OrderID]
			if !ok {
				t.Fatal("original order missing")
			}
			orderID = order.ID
			// Read original prepared metadata, never a callback or rewritten DB.
			origins := map[string]bool{}
			for _, effect := range store.s.BusinessEffects {
				if effect.Kind == "pay.native-create" && effect.Target == orderID && effect.Phase == "completed" {
					var original nativeInvoiceInput
					if decodeEffect(effect.Input, &original) != nil {
						t.Fatal("original native create metadata invalid")
					}
					origins[original.Origin] = true
				}
			}
			if len(origins) != 1 {
				t.Fatal("one retained completed native-create origin required")
			}
			for origin := range origins {
				frozenPayOrigin = origin
			}

			secret, err := hex.DecodeString(c.SecretHex)
			if err != nil || len(secret) < 32 {
				t.Fatal("PUBLIC actual merchant notification key required")
			}
			ca := x509.NewCertPool()
			if !c.OriginalPUBLICHTTP && !ca.AppendCertsFromPEM([]byte(c.CAPEM)) {
				t.Fatal("PUBLIC Pay original TLS CA required")
			}
			transport = &http.Transport{TLSClientConfig: &tls.Config{RootCAs: ca, MinVersion: tls.VersionTLS13}}
			trace := nativeShopPayTransport(func(r *http.Request) (*http.Response, error) {
				if r.Method != http.MethodGet || r.ContentLength > 0 || r.GetBody != nil {
					return nil, fmt.Errorf("notification driver permits original Pay GET only")
				}
				traceMu.Lock()
				reads = append(reads, r.URL.EscapedPath())
				traceMu.Unlock()
				return transport.RoundTrip(r)
			})
			var client *NativeShopPayClient
			if c.OriginalPUBLICHTTP {
				// Same explicit PUBLIC protocol used by the retained old driver.
				// No URL rewrite/dial substitution, HTTP fallback or production
				// constructor change. Caller must restore the exact old peer.
				originalURL, parseErr := url.Parse(c.Origin)
				if parseErr != nil || c.Origin != frozenPayOrigin || originalURL.Scheme != "http" || !net.ParseIP(originalURL.Hostname()).IsLoopback() || originalURL.User != nil || originalURL.Path != "" || originalURL.RawQuery != "" || originalURL.Fragment != "" {
					t.Fatal("exact frozen PUBLIC loopback HTTP authority required")
				}
				client = &NativeShopPayClient{origin: c.Origin, client: http.Client{Transport: trace, Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
				result["PUBLICOriginalHTTPReader"] = true
			} else {
				client, err = NewOriginalNativeShopPayClient(c.Origin, &http.Client{Transport: trace, Timeout: 20 * time.Second})
				if err != nil {
					t.Fatal(err)
				}
				result["PUBLICOriginalHTTPReader"] = false
			}
			result["frozenPayOrigin"] = frozenPayOrigin
			result["configuredPayOrigin"] = c.Origin
			result["sameFrozenOrigin"] = c.Origin == frozenPayOrigin

			cfg = ServerConfig{NativeInvoiceOnly: true, NativePay: client, businessV2: controlledBusinessVerifier{account: order.Buyer, role: "buyer"}, NativePayNotificationReceivers: []NativePayNotificationReceiver{{MerchantID: c.MerchantID, StoreID: order.StoreID, SecretVersion: c.SecretVersion, Secret: secret}}}
			current = NewServer(store, cfg).Handler()
			tlsServer = httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gate.RLock()
				defer gate.RUnlock()
				current.ServeHTTP(w, r)
			}))
			tlsServer.TLS = &tls.Config{MinVersion: tls.VersionTLS13}
			tlsServer.StartTLS()
			result["endpoint"] = tlsServer.URL + "/api/pay/notifications/native"
			result["caPEM"] = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: tlsServer.Certificate().Raw}))
			result["statePath"] = statePath
			result["sourceOrder"] = orderID
			result["storeId"] = order.StoreID
			result["invoiceId"] = order.InvoiceID
		case "read":
			if store == nil {
				t.Fatal("init required")
			}
			gate.Lock()
			_, preflight := store.nativePaymentInput(store.s.Orders[orderID].Buyer, orderID, cfg.NativePay.origin)
			if preflight != nil {
				result["originalBindingPreflightError"] = preflight.Error()
			} else {
				result["originalBindingPreflightError"] = ""
			}
			result["frozenPayOrigin"] = frozenPayOrigin
			result["configuredPayOrigin"] = cfg.NativePay.origin
			result["sameFrozenOrigin"] = frozenPayOrigin == cfg.NativePay.origin
			w := businessHTTPRequest(NewServer(store, cfg), "POST", "/api/orders/"+orderID+"/confirm-payment", fmt.Sprintf("n%042d", sequence), `{}`)
			gate.Unlock()
			result["httpStatus"] = w.Code
			if w.Code >= 400 {
				var failure map[string]any
				if json.Unmarshal(w.Body.Bytes(), &failure) == nil {
					safe := map[string]string{}
					for _, key := range []string{"code", "error", "message"} {
						if text, ok := failure[key].(string); ok {
							runes := []rune(text)
							if len(runes) > 256 {
								text = string(runes[:256])
							}
							safe[key] = text
						}
					}
					result["readError"] = safe
				}
			}

		case "cold":
			if store == nil {
				t.Fatal("init required")
			}
			gate.Lock()
			next, err := Open(statePath)
			if err != nil {
				gate.Unlock()
				t.Fatal(err)
			}
			store = next
			current = NewServer(store, cfg).Handler()
			gate.Unlock()
		case "inspect":
			if store == nil {
				t.Fatal("init required")
			}
		case "stop":
			reply(result)
			return
		default:
			t.Fatal("unknown PUBLIC notification command")
		}
		if store != nil {
			gate.Lock()
			store.mu.Lock()
			order := cloneOrder(store.s.Orders[orderID])
			refs := []map[string]string{}
			for _, n := range store.s.NativePayNotifications {
				refs = append(refs, map[string]string{"eventId": n.EventID, "nativeHash": n.NativeHash, "observedOrderId": n.ObservedOrderID, "payloadSHA256": n.PayloadSHA256})
			}
			snapshotHash := requestHash(store.s)
			store.mu.Unlock()
			gate.Unlock()
			result["orderStatus"] = order.Status
			result["originalNotificationCount"] = len(refs)
			result["notifications"] = refs
			result["snapshotHash"] = snapshotHash
			result["schema"] = strconv.Itoa(CurrentPersistenceSchemaVersion)
			if order.NativePayment != nil {
				result["paidAtoms"] = order.NativePayment.PaidAtoms
				result["refundedAtoms"] = order.NativePayment.RefundedAtoms
				result["netPaidAtoms"] = order.NativePayment.NetPaidAtoms
			}
			traceMu.Lock()
			result["qualifiedOriginalGETs"] = append([]string{}, reads...)
			traceMu.Unlock()
			if c.Command == "init" {
				original, err := os.ReadFile(c.SourcePath)
				hash := sha256.Sum256(original)
				if err != nil || hex.EncodeToString(hash[:]) != c.SourceSHA256 {
					t.Fatal("original source changed")
				}
			}
		}
		reply(result)
	}
	if err := input.Err(); err != nil {
		t.Fatal(err)
	}
}
