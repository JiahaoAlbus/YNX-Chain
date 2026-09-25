package finance

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	secpECDSA "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"
)

func testEVMLoginKey() (*secp256k1.PrivateKey, string) {
	secret := make([]byte, 32)
	secret[31] = 7
	key := secp256k1.PrivKeyFromBytes(secret)
	hash := sha3.NewLegacyKeccak256()
	_, _ = hash.Write(key.PubKey().SerializeUncompressed()[1:])
	return key, "0x" + hex.EncodeToString(hash.Sum(nil)[12:])
}

func testEVMPersonalSign(key *secp256k1.PrivateKey, message string) string {
	hash := sha3.NewLegacyKeccak256()
	_, _ = fmt.Fprintf(hash, "\x19Ethereum Signed Message:\n%d%s", len([]byte(message)), message)
	compact := secpECDSA.SignCompact(key, hash.Sum(nil), false)
	signature := append(append([]byte{}, compact[1:]...), compact[0])
	return "0x" + hex.EncodeToString(signature)
}

func postEVMLogin(t *testing.T, url string, body any, origin string) (*http.Response, map[string]any) {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(encoded))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	if origin != "" {
		request.Header.Set("Origin", origin)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result map[string]any
	if err := json.NewDecoder(io.LimitReader(response.Body, 32<<10)).Decode(&result); err != nil {
		t.Fatal(err)
	}
	return response, result
}

func TestEVMLoginHTTPRealWalletVerifierAndDurableReplay(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node runtime is unavailable; run the Finance login gate after npm ci")
	}
	script, err := filepath.Abs(filepath.Join("..", "..", "apps", "finance", "scripts", "evm-product-login-authority.bundle.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(script); err != nil {
		t.Fatal("Finance release verifier bundle is missing")
	}
	authority, err := NewNodeEVMLoginAuthority(node, script, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	storePath := filepath.Join(t.TempDir(), "finance.json")
	store, err := OpenStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	upstreams, err := NewUpstreams("https://explorer.example", "", "", "https://support.example/dispute")
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{Store: store, Upstreams: upstreams, AI: fakeAI{}, Support: SupportLinks{HelpURL: "https://support.example/help", PrivacyURL: "https://support.example/privacy", DisputeURL: "https://support.example/dispute"}}
	auth, _ := testAuthenticator(t, "fixture-private-session")
	server, err := NewServer(service, auth, ServerConfig{AllowedOrigins: []string{"https://finance.example", "https://other-finance.example"}, CursorSigningKey: testCursorKey, OperationsKey: testOperationsKey, EVMLoginAuthority: authority, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	key, account := testEVMLoginKey()
	challengeURL := httpServer.URL + "/api/wallet-login/challenges"
	verifyURL := httpServer.URL + "/api/wallet-login/verify"
	if response, _ := postEVMLogin(t, challengeURL, map[string]any{"account": account, "providerKind": "metamask"}, ""); response.StatusCode != http.StatusForbidden {
		t.Fatal("originless challenge was accepted")
	}
	response, issued := postEVMLogin(t, challengeURL, map[string]any{"account": account, "providerKind": "metamask"}, "https://finance.example")
	if response.StatusCode != http.StatusCreated || issued["schemaVersion"] != "finance-evm-login-challenge-v1" || issued["privateFinanceAuthorized"] != false {
		t.Fatalf("challenge was not durably issued: status=%d body=%#v", response.StatusCode, issued)
	}
	challenge := issued["challenge"].(map[string]any)
	signing := issued["signingRequest"].(map[string]any)
	if signing["method"] != "personal_sign" || challenge["chainId"] != float64(6423) || challenge["account"] != account || challenge["productId"] != "finance" {
		t.Fatalf("Wallet/Auth challenge binding is invalid: %#v %#v", challenge, signing)
	}
	reopened, err := OpenStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.WalletLoginChallenge(account, challenge["requestId"].(string)); err != nil {
		t.Fatalf("challenge did not survive a second store start: %v", err)
	}
	proof := map[string]any{"challenge": challenge, "message": signing["message"], "signature": testEVMPersonalSign(key, signing["message"].(string))}
	if response, _ := postEVMLogin(t, verifyURL, map[string]any{"proof": proof}, "https://other-finance.example"); response.StatusCode != http.StatusForbidden {
		t.Fatal("proof was accepted from a different registered origin")
	}
	wrong := map[string]any{"challenge": challenge, "message": signing["message"], "signature": "0x" + strings.Repeat("00", 65)}
	if response, _ := postEVMLogin(t, verifyURL, map[string]any{"proof": wrong}, "https://finance.example"); response.StatusCode != http.StatusUnauthorized {
		t.Fatal("invalid signature was accepted")
	}
	var group sync.WaitGroup
	statuses := make(chan int, 2)
	for range 2 {
		group.Add(1)
		go func() {
			defer group.Done()
			encoded, _ := json.Marshal(map[string]any{"proof": proof})
			request, _ := http.NewRequest(http.MethodPost, verifyURL, bytes.NewReader(encoded))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Origin", "https://finance.example")
			result, err := http.DefaultClient.Do(request)
			if err != nil {
				statuses <- 0
				return
			}
			_ = result.Body.Close()
			statuses <- result.StatusCode
		}()
	}
	group.Wait()
	close(statuses)
	wins, replays := 0, 0
	for status := range statuses {
		if status == http.StatusOK {
			wins++
		} else if status == http.StatusConflict || status == http.StatusUnauthorized {
			replays++
		}
	}
	if wins != 1 || replays != 1 {
		t.Fatalf("concurrent signature proof had %d winners and %d replay rejects", wins, replays)
	}
	stored, err := reopened.WalletLoginChallenge(account, challenge["requestId"].(string))
	if err != nil || stored.ConsumedAt == nil {
		t.Fatalf("proof consumption did not persist across instances: %#v %v", stored, err)
	}
	if response, _ := postEVMLogin(t, verifyURL, map[string]any{"proof": proof}, "https://finance.example"); response.StatusCode != http.StatusUnauthorized {
		t.Fatal("persisted replay was accepted")
	}
	privateResponse, err := http.Get(httpServer.URL + "/api/overview")
	if err != nil {
		t.Fatal(err)
	}
	_ = privateResponse.Body.Close()
	if privateResponse.StatusCode == http.StatusOK {
		t.Fatal("standard Wallet login bypassed the separate private Finance authority")
	}
}
