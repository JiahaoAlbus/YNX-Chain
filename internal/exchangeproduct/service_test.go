package exchangeproduct

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

const adminKey = "test-admin-api-key-123456"

var (
	alice, aliceKey = testIdentity(1)
	bob, bobKey     = testIdentity(2)
	carol, carolKey = testIdentity(3)
)

func testIdentity(seed byte) (string, *secp256k1.PrivateKey) {
	secret := make([]byte, 32)
	secret[31] = seed
	key := secp256k1.PrivKeyFromBytes(secret)
	account, err := walletAccount(hex.EncodeToString(key.PubKey().SerializeCompressed()))
	if err != nil {
		panic(err)
	}
	return account, key
}

func signAction(key *secp256k1.PrivateKey, payload []byte) string {
	h := sha256.Sum256(payload)
	signature := ecdsa.Sign(key, h[:])
	rScalar := signature.R()
	sScalar := signature.S()
	r := rScalar.Bytes()
	s := sScalar.Bytes()
	return hex.EncodeToString(append(r[:], s[:]...))
}

type fakeChain struct {
	mu        sync.Mutex
	transfers map[string]ChainTransfer
}

func (f *fakeChain) Transfer(hash string) (ChainTransfer, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	v, ok := f.transfers[hash]
	if !ok {
		return ChainTransfer{}, ErrNotFound
	}
	return v, nil
}
func (f *fakeChain) set(hash string, v ChainTransfer) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.transfers[hash] = v
}

type testAccount struct {
	session WalletSession
	private *secp256k1.PrivateKey
	token   string
	account string
}

func newTestService(t *testing.T) (*Service, *fakeChain, string) {
	t.Helper()
	chain := &fakeChain{transfers: map[string]ChainTransfer{}}
	path := filepath.Join(t.TempDir(), "exchange.json")
	s, err := New(Config{StatePath: path, APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback", CustodyAddress: bob, IndexerURL: "https://indexer.test.invalid", RequiredConfirmations: 3, MakerFeeBPS: 10, TakerFeeBPS: 20, WithdrawalFeeMicroYNXT: 10_000, Chain: chain})
	if err != nil {
		t.Fatal(err)
	}
	return s, chain, path
}
func accountSession(t *testing.T, s *Service, account, device string, scopes ...string) testAccount {
	t.Helper()
	keys := map[string]*secp256k1.PrivateKey{alice: aliceKey, bob: bobKey, carol: carolKey}
	priv := keys[account]
	if priv == nil {
		t.Fatalf("no test key for account %s", account)
	}
	c, err := s.CreateChallenge(account, device, scopes)
	if err != nil {
		t.Fatal(err)
	}
	publicKey := hex.EncodeToString(priv.PubKey().SerializeCompressed())
	session, token, err := s.CompleteSession(CompleteSessionRequest{ChallengeID: c.ID, WalletPublicKey: publicKey, WalletSignature: signAction(priv, WalletChallengePayload(c))})
	if err != nil {
		t.Fatal(err)
	}
	return testAccount{session: session, private: priv, token: token, account: account}
}
func place(t *testing.T, s *Service, a testAccount, side string, price, amount int64, key string) (Order, error) {
	t.Helper()
	req := PlaceOrderRequest{Market: DefaultMarket, Side: side, Type: "limit", PriceMicro: price, AmountMicro: amount, IdempotencyKey: key}
	req.WalletSignature = signAction(a.private, OrderAuthorizationPayload(a.session.Account, req))
	return s.PlaceOrder(a.session, req)
}
func confirmDeposit(t *testing.T, s *Service, chain *fakeChain, a testAccount, hash string, amount int64) {
	t.Helper()
	chain.set(hash, ChainTransfer{Hash: hash, From: bob, To: bob, AmountMicro: amount, Confirmations: 3, Committed: true})
	intent, err := s.CreateDepositIntent(a.session, "intent-"+hash)
	if err != nil {
		t.Fatal(err)
	}
	d, err := s.ObserveDeposit(a.session, intent.ID, hash, "deposit-"+hash)
	if err != nil {
		t.Fatal(err)
	}
	if d.Status != "confirmed" {
		t.Fatalf("deposit status=%s", d.Status)
	}
}

func TestOrderLifecycleBalanceReservationAndFees(t *testing.T) {
	s, chain, _ := newTestService(t)
	seller := accountSession(t, s, alice, "seller", "exchange:read", "exchange:trade", "exchange:withdraw")
	buyer := accountSession(t, s, bob, "buyer", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, seller, "aaaaaaaaaaaaaaaa", 20*AmountScale)
	if _, err := s.CreditTestQuote("Bearer "+adminKey, bob, 100*AmountScale, "credit-buyer-01"); err != nil {
		t.Fatal(err)
	}
	sell, err := place(t, s, seller, "sell", 2*AmountScale, 10*AmountScale, "order-sell-0001")
	if err != nil || sell.Status != "open" || sell.ReservedMicro != 10*AmountScale {
		t.Fatalf("sell=%+v err=%v", sell, err)
	}
	buy1, err := place(t, s, buyer, "buy", 2*AmountScale, 4*AmountScale, "order-buy-0001")
	if err != nil || buy1.Status != "filled" {
		t.Fatalf("buy1=%+v err=%v", buy1, err)
	}
	sell = s.Book().Asks[0]
	if sell.Status != "partially_filled" || sell.FilledMicro != 4*AmountScale {
		t.Fatalf("partial sell=%+v", sell)
	}
	buy2, err := place(t, s, buyer, "buy", 2*AmountScale, 6*AmountScale, "order-buy-0002")
	if err != nil || buy2.Status != "filled" {
		t.Fatalf("buy2=%+v err=%v", buy2, err)
	}
	snapSeller := s.Snapshot(alice)
	if snapSeller.Orders[0].Status != "filled" {
		t.Fatalf("seller order=%+v", snapSeller.Orders[0])
	}
	if len(snapSeller.Trades) != 2 || len(snapSeller.Fees) != 2 {
		t.Fatalf("trades=%d fees=%d", len(snapSeller.Trades), len(snapSeller.Fees))
	}
	if snapSeller.Balances[0].ReservedMicro != 0 {
		t.Fatalf("reserved=%d", snapSeller.Balances[0].ReservedMicro)
	}
	open, err := place(t, s, seller, "sell", 3*AmountScale, 2*AmountScale, "order-sell-cancel")
	if err != nil {
		t.Fatal(err)
	}
	key := "cancel-order-0001"
	sig := signAction(seller.private, []byte("ynx-exchange-cancel-v1\n"+alice+"\n"+open.ID+"\n"+key))
	cancelled, err := s.CancelOrder(seller.session, open.ID, key, sig)
	if err != nil || cancelled.Status != "cancelled" {
		t.Fatalf("cancel=%+v err=%v", cancelled, err)
	}
	assertLedgerBalances(t, s.Snapshot(alice))
	assertLedgerBalances(t, s.Snapshot(bob))
}

func assertLedgerBalances(t *testing.T, snapshot AccountSnapshot) {
	t.Helper()
	available := map[string]int64{}
	reserved := map[string]int64{}
	for _, entry := range snapshot.Ledger {
		available[entry.Asset] += entry.AvailableDelta
		reserved[entry.Asset] += entry.ReservedDelta
		if entry.SourceType == "" || entry.SourceID == "" || entry.SourceDigest == "" {
			t.Fatalf("untraceable ledger entry: %+v", entry)
		}
	}
	for _, balance := range snapshot.Balances {
		if available[balance.Asset] != balance.AvailableMicro || reserved[balance.Asset] != balance.ReservedMicro {
			t.Fatalf("ledger mismatch %s: ledger=%d/%d balance=%d/%d", balance.Asset, available[balance.Asset], reserved[balance.Asset], balance.AvailableMicro, balance.ReservedMicro)
		}
	}
}

func TestSelfTradeRejectedAndAuthorization(t *testing.T) {
	s, chain, _ := newTestService(t)
	a := accountSession(t, s, alice, "alice", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, a, "bbbbbbbbbbbbbbbb", 10*AmountScale)
	if _, err := s.CreditTestQuote(adminKey, alice, 100*AmountScale, "credit-alice-01"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, s, a, "sell", 2*AmountScale, 2*AmountScale, "sell-self-0001"); err != nil {
		t.Fatal(err)
	}
	rejected, err := place(t, s, a, "buy", 2*AmountScale, 1*AmountScale, "buy-self-00001")
	if err != nil || rejected.Status != "rejected" || rejected.RejectReason != "self_trade_prevention" {
		t.Fatalf("rejected=%+v err=%v", rejected, err)
	}
	req := PlaceOrderRequest{Market: DefaultMarket, Side: "buy", Type: "limit", PriceMicro: AmountScale, AmountMicro: AmountScale, IdempotencyKey: "bad-signature-01", WalletSignature: "invalid"}
	if _, err := s.PlaceOrder(a.session, req); err != ErrUnauthorized {
		t.Fatalf("expected unauthorized, got %v", err)
	}
	if _, err := s.Authenticate("bad token", "exchange:read"); err != ErrUnauthorized {
		t.Fatalf("session auth: %v", err)
	}
}

func TestWalletChallengeReplayAndOrderIdempotencyConflict(t *testing.T) {
	s, _, _ := newTestService(t)
	mismatch, err := s.CreateChallenge(alice, "wrong-key-device", []string{"exchange:read"})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.CompleteSession(CompleteSessionRequest{ChallengeID: mismatch.ID, WalletPublicKey: hex.EncodeToString(bobKey.PubKey().SerializeCompressed()), WalletSignature: signAction(bobKey, WalletChallengePayload(mismatch))}); err != ErrUnauthorized {
		t.Fatalf("public-key/account mismatch err=%v", err)
	}
	c, err := s.CreateChallenge(alice, "replay-device", []string{"exchange:read", "exchange:trade"})
	if err != nil {
		t.Fatal(err)
	}
	reqSession := CompleteSessionRequest{ChallengeID: c.ID, WalletPublicKey: hex.EncodeToString(aliceKey.PubKey().SerializeCompressed()), WalletSignature: signAction(aliceKey, WalletChallengePayload(c))}
	session, _, err := s.CompleteSession(reqSession)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.CompleteSession(reqSession); err != ErrUnauthorized {
		t.Fatalf("challenge replay err=%v", err)
	}
	if _, err := s.CreditTestQuote(adminKey, alice, 10*AmountScale, "idempotent-credit"); err != nil {
		t.Fatal(err)
	}
	a := testAccount{session: session, private: aliceKey, account: alice}
	first, err := place(t, s, a, "buy", AmountScale, AmountScale, "same-order-key")
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := place(t, s, a, "buy", AmountScale, AmountScale, "same-order-key")
	if err != nil || replayed.ID != first.ID {
		t.Fatalf("replay=%+v err=%v", replayed, err)
	}
	if _, err := place(t, s, a, "buy", 2*AmountScale, AmountScale, "same-order-key"); err != ErrConflict {
		t.Fatalf("changed replay err=%v", err)
	}
}

func TestDepositConfirmationRestartReplayAndTamper(t *testing.T) {
	s, chain, path := newTestService(t)
	a := accountSession(t, s, alice, "deposit", "exchange:read", "exchange:trade")
	hash := "cccccccccccccccc"
	chain.set(hash, ChainTransfer{Hash: hash, From: bob, To: bob, AmountMicro: 5 * AmountScale, Confirmations: 1, Committed: true})
	intent, err := s.CreateDepositIntent(a.session, "intent-observe-01")
	if err != nil {
		t.Fatal(err)
	}
	d, err := s.ObserveDeposit(a.session, intent.ID, hash, "deposit-observe-01")
	if err != nil || d.Status != "confirming" {
		t.Fatalf("deposit=%+v err=%v", d, err)
	}
	replay, err := s.ObserveDeposit(a.session, intent.ID, hash, "deposit-observe-01")
	if err != nil || replay.ID != d.ID {
		t.Fatalf("replay=%+v err=%v", replay, err)
	}
	chain.set(hash, ChainTransfer{Hash: hash, From: bob, To: bob, AmountMicro: 5 * AmountScale, Confirmations: 3, Committed: true})
	d, err = s.RefreshDeposit(a.session, d.ID)
	if err != nil || d.Status != "confirmed" {
		t.Fatalf("refresh=%+v err=%v", d, err)
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.Snapshot(alice).Balances[0].AvailableMicro != 5*AmountScale {
		t.Fatalf("restart lost balance")
	}
	if _, err := restarted.ObserveDeposit(a.session, intent.ID, hash, "deposit-other-key"); err != ErrForbidden && err != ErrConflict {
		t.Fatalf("duplicate tx=%v", err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	raw["sequence"] = float64(999999)
	changed, _ := json.Marshal(raw)
	if err := os.WriteFile(path, changed, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(s.cfg); err == nil {
		t.Fatal("tampered persistence accepted")
	}
}

func TestConcurrentMatchingIsAtomic(t *testing.T) {
	s, chain, _ := newTestService(t)
	seller := accountSession(t, s, alice, "seller", "exchange:trade")
	confirmDeposit(t, s, chain, seller, "dddddddddddddddd", 10*AmountScale)
	if _, err := place(t, s, seller, "sell", AmountScale, 10*AmountScale, "concurrent-sell"); err != nil {
		t.Fatal(err)
	}
	buyers := make([]testAccount, 10)
	for i := range buyers {
		buyers[i] = accountSession(t, s, bob, "buyer"+string(rune('a'+i)), "exchange:trade")
		if _, err := s.CreditTestQuote(adminKey, bob, 2*AmountScale, "concurrent-credit-"+string(rune('a'+i))); err != nil {
			t.Fatal(err)
		}
	}
	var wg sync.WaitGroup
	errs := make(chan error, 10)
	for i, a := range buyers {
		wg.Add(1)
		go func(i int, a testAccount) {
			defer wg.Done()
			_, err := placeNoTest(s, a, "buy", AmountScale, AmountScale, "concurrent-buy-"+string(rune('a'+i)))
			errs <- err
		}(i, a)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	snap := s.Snapshot(alice)
	if len(snap.Trades) != 10 || snap.Orders[0].Status != "filled" {
		t.Fatalf("trades=%d order=%+v", len(snap.Trades), snap.Orders[0])
	}
	if snap.Balances[0].ReservedMicro != 0 {
		t.Fatalf("seller reserve=%d", snap.Balances[0].ReservedMicro)
	}
}

func TestPriceTimePriorityIsDeterministicWhenTimestampsMatch(t *testing.T) {
	s, chain, _ := newTestService(t)
	s.cfg.Now = func() time.Time { return time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC) }
	a := accountSession(t, s, alice, "priority-alice", "exchange:trade")
	b := accountSession(t, s, bob, "priority-bob", "exchange:trade")
	c := accountSession(t, s, carol, "priority-carol", "exchange:trade")
	if _, err := s.CreditTestQuote(adminKey, a.account, 10*AmountScale, "priority-credit-buyer"); err != nil {
		t.Fatal(err)
	}
	confirmDeposit(t, s, chain, b, "abababababababab", AmountScale)
	confirmDeposit(t, s, chain, c, "cdcdcdcdcdcdcdcd", AmountScale)
	first, err := place(t, s, b, "sell", AmountScale, AmountScale, "priority-maker-1")
	if err != nil {
		t.Fatal(err)
	}
	second, err := place(t, s, c, "sell", AmountScale, AmountScale, "priority-maker-2")
	if err != nil {
		t.Fatal(err)
	}
	if first.CreatedAt != second.CreatedAt || first.ID >= second.ID {
		t.Fatalf("fixture does not share a stable timestamp/ID ordering: first=%+v second=%+v", first, second)
	}
	if _, err := place(t, s, a, "buy", AmountScale, AmountScale, "priority-taker"); err != nil {
		t.Fatal(err)
	}
	orders := s.Snapshot(b.account).Orders
	if len(orders) != 1 || orders[0].Status != "filled" {
		t.Fatalf("first same-time maker was not filled first: %+v", orders)
	}
	orders = s.Snapshot(c.account).Orders
	if len(orders) != 1 || orders[0].Status != "open" {
		t.Fatalf("second same-time maker did not remain open: %+v", orders)
	}
}

func TestDepositIntentLedgerAuditChainAndRiskControls(t *testing.T) {
	s, chain, _ := newTestService(t)
	a := accountSession(t, s, alice, "traceable", "exchange:read", "exchange:trade", "exchange:withdraw")
	intent, err := s.CreateDepositIntent(a.session, "trace-intent-01")
	if err != nil || intent.Address != bob || intent.Status != "awaiting_chain_transfer" || intent.IndexerSource == "" {
		t.Fatalf("intent=%+v err=%v", intent, err)
	}
	hash := "eeeeeeeeeeeeeeee"
	chain.set(hash, ChainTransfer{Hash: hash, From: bob, To: bob, AmountMicro: 3 * AmountScale, Confirmations: 3, Committed: true})
	deposit, err := s.ObserveDeposit(a.session, intent.ID, hash, "trace-deposit-01")
	if err != nil || deposit.SourceType != "ynx_indexer_transfer" || deposit.SourceDigest == "" {
		t.Fatalf("deposit=%+v err=%v", deposit, err)
	}
	snapshot := s.Snapshot(alice)
	if len(snapshot.Ledger) == 0 || snapshot.Ledger[0].SourceID != deposit.ID || snapshot.Ledger[0].SourceDigest != deposit.SourceDigest {
		t.Fatalf("ledger not traceable: %+v", snapshot.Ledger)
	}
	for i, event := range snapshot.Audit {
		if event.Hash == "" {
			t.Fatalf("audit %d missing hash", i)
		}
		if i > 0 && event.PreviousHash != snapshot.Audit[i-1].Hash {
			t.Fatalf("audit chain broken at %d", i)
		}
	}
	s.cfg.MaxOrderNotionalMicro = AmountScale
	if _, err := place(t, s, a, "sell", 2*AmountScale, AmountScale, "risk-order-01"); err != ErrForbidden {
		t.Fatalf("order risk=%v", err)
	}
	status := s.Integrations()
	if status.Gateway != "unavailable" || status.WalletRegistry != "pending_registration" || status.CrossChain != "unavailable" {
		t.Fatalf("integration truth=%+v", status)
	}
}
func placeNoTest(s *Service, a testAccount, side string, price, amount int64, key string) (Order, error) {
	req := PlaceOrderRequest{Market: DefaultMarket, Side: side, Type: "limit", PriceMicro: price, AmountMicro: amount, IdempotencyKey: key}
	req.WalletSignature = signAction(a.private, OrderAuthorizationPayload(a.session.Account, req))
	return s.PlaceOrder(a.session, req)
}

func TestWithdrawalReviewExactFeeAndSecurityLock(t *testing.T) {
	s, chain, _ := newTestService(t)
	a := accountSession(t, s, alice, "withdraw", "exchange:read", "exchange:trade", "exchange:withdraw")
	confirmDeposit(t, s, chain, a, "eeeeeeeeeeeeeeee", 10*AmountScale)
	req := WithdrawalReviewRequest{Asset: NativeAsset, Network: "YNX Testnet", Destination: bob, AmountMicro: 2 * AmountScale, IdempotencyKey: "withdraw-review-01"}
	payload := []byte("ynx-exchange-withdrawal-review-v1\n" + alice + "\nYNXT\nYNX Testnet\n" + bob + "\n2000000\n10000\nwithdraw-review-01")
	req.WalletSignature = signAction(a.private, payload)
	w, err := s.ReviewWithdrawal(a.session, req)
	if err != nil || w.FeeMicro != 10_000 || w.ReceiveMicro != 1_990_000 || !w.WalletAuthorized || w.Status != "reviewed_pending_operator_broadcast" {
		t.Fatalf("withdrawal=%+v err=%v", w, err)
	}
	if _, err := s.UpdateSecurity(a.session, SecuritySettings{WithdrawalLock: true, OrderConfirmation: true, SessionTTLMinutes: 60}); err != nil {
		t.Fatal(err)
	}
	req.IdempotencyKey = "withdraw-review-02"
	req.WalletSignature = signAction(a.private, []byte("ynx-exchange-withdrawal-review-v1\n"+alice+"\nYNXT\nYNX Testnet\n"+bob+"\n2000000\n10000\nwithdraw-review-02"))
	if _, err := s.ReviewWithdrawal(a.session, req); err != ErrForbidden {
		t.Fatalf("lock err=%v", err)
	}
}

func TestAIPermissionFailureRetryCancelAndDeletionAudit(t *testing.T) {
	s, _, _ := newTestService(t)
	a := accountSession(t, s, alice, "ai", "exchange:read", "exchange:ai")
	r, err := s.DraftAI(a.session, "order_draft", "Draft a limit order without placing it", []string{"owned_balances"}, false)
	if err != nil || r.Status != "permission_required" || r.Provider != "YNX AI Gateway" {
		t.Fatalf("record=%+v err=%v", r, err)
	}
	r, err = s.ReviewAI(a.session, r.ID, "retry")
	if err != nil || r.Status != "provider_unavailable" {
		t.Fatalf("retry=%+v err=%v", r, err)
	}
	r, err = s.ReviewAI(a.session, r.ID, "cancel")
	if err != nil || r.Status != "cancelled" {
		t.Fatalf("cancel=%+v err=%v", r, err)
	}
	r, err = s.ReviewAI(a.session, r.ID, "delete")
	if err != nil || r.Status != "deleted" || r.Prompt != "" || len(r.ContextClasses) != 0 {
		t.Fatalf("delete=%+v err=%v", r, err)
	}
	for _, stored := range s.Snapshot(alice).AI {
		if stored.ID == r.ID {
			t.Fatal("deleted AI context remains in state")
		}
	}
}

func TestAIOrderDraftApprovalIsExactOneUseAndCannotPlaceOrder(t *testing.T) {
	s, _, _ := newTestService(t)
	a := accountSession(t, s, alice, "ai-approval", "exchange:read", "exchange:ai", "exchange:trade")
	r, err := s.DraftAI(a.session, "order_draft", "Explain and draft an exact one YNXT limit buy", []string{"owned_balances", "public_market_rules"}, true)
	if err != nil || r.Status != "provider_unavailable" {
		t.Fatalf("draft=%+v err=%v", r, err)
	}
	if _, err := s.ReviewAI(a.session, r.ID, "approve"); err != ErrConflict {
		t.Fatalf("unavailable AI result approval err=%v", err)
	}

	// Simulate the future approved Gateway adapter persisting an exact result.
	// The branch has no configured provider and never fabricates this state in
	// production, but the approval transition must already fail closed.
	s.mu.Lock()
	r = s.state.AI[r.ID]
	r.ProviderStatus = "available"
	r.Provider = "YNX AI Gateway"
	r.Model = "operator-approved-model"
	r.Result = `{"market":"YNXT/YUSD_TEST","side":"buy","type":"limit","priceMicro":1000000,"amountMicro":1000000}`
	r.Status = "result_ready"
	s.state.AI[r.ID] = r
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		s.mu.Unlock()
		t.Fatal(err)
	}
	s.mu.Unlock()

	approved, err := s.ReviewAI(a.session, r.ID, "approve")
	if err != nil || approved.Status != "approved_for_wallet_review" || approved.ApprovalDigest == "" {
		t.Fatalf("approved=%+v err=%v", approved, err)
	}
	if _, err := s.ReviewAI(a.session, r.ID, "approve"); err != ErrConflict {
		t.Fatalf("approval replay err=%v", err)
	}
	if got := s.Snapshot(alice).Orders; len(got) != 0 {
		t.Fatalf("AI approval created orders: %+v", got)
	}
}

func TestHTTPStrictParsingScopeAndSmoke(t *testing.T) {
	s, _, _ := newTestService(t)
	server := httptest.NewServer(NewServer(s))
	defer server.Close()
	resp, err := http.Get(server.URL + "/health")
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("health err=%v status=%v", err, resp.StatusCode)
	}
	resp.Body.Close()
	resp, err = http.Post(server.URL+"/v1/auth/challenges", "application/json", strings.NewReader(`{"account":"`+alice+`","deviceId":"web","scopes":["exchange:read"],"unknown":true}`))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 400 {
		t.Fatalf("strict parse status=%d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestCentralGatewayIntrospectionScopeAndBinding(t *testing.T) {
	expires := time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano)
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 42))
	publicKey := hex.EncodeToString(key.PubKey().SerializeCompressed())
	account, err := walletAccount(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	var gotPath, gotAuth string
	allowTrade := false
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		scopes := []string{"exchange:read"}
		if allowTrade {
			scopes = append(scopes, "exchange:trade")
		}
		writeJSON(w, 200, map[string]any{"verifierVersion": "wallet-auth-v1", "productClientId": "ynx-exchange-v1", "bundleId": "com.ynxweb4.exchange", "account": account, "accountPublicKey": publicKey, "scopes": scopes, "expiresAt": expires})
	}))
	defer gateway.Close()
	authorizer := HTTPGatewayAuthorizer{BaseURL: gateway.URL, Client: gateway.Client()}
	session, err := authorizer.Authorize("central-token", "exchange:read", "ynx-exchange-v1")
	if err != nil || session.Account != account {
		t.Fatalf("account=%s public=%s session=%+v err=%v", account, publicKey, session, err)
	}
	if gotPath != "/v1/sessions/introspect" || gotAuth != "Bearer central-token" {
		t.Fatalf("gateway request path=%s auth=%s", gotPath, gotAuth)
	}
	if _, err := authorizer.Authorize("central-token", "exchange:trade", "ynx-exchange-v1"); err != ErrForbidden {
		t.Fatalf("scope err=%v", err)
	}
	allowTrade = true
	centralSession, err := authorizer.Authorize("central-token", "exchange:trade", "ynx-exchange-v1")
	if err != nil {
		t.Fatal(err)
	}
	s, _, _ := newTestService(t)
	if _, err := s.CreditTestQuote(adminKey, account, 10*AmountScale, "central-action-credit"); err != nil {
		t.Fatal(err)
	}
	req := PlaceOrderRequest{Market: DefaultMarket, Side: "buy", Type: "limit", PriceMicro: AmountScale, AmountMicro: AmountScale, IdempotencyKey: "central-action-order"}
	req.WalletSignature = signAction(key, OrderAuthorizationPayload(account, req))
	order, err := s.PlaceOrder(centralSession, req)
	if err != nil || order.Status != "open" || !order.WalletAuthorized {
		t.Fatalf("central Wallet action order=%+v err=%v", order, err)
	}
}

func TestMissingCustodyAndChainDisableAssetRoutes(t *testing.T) {
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback"})
	if err != nil {
		t.Fatal(err)
	}
	networks := s.Networks()
	if networks[0].DepositEnabled || networks[0].WithdrawalEnabled || networks[0].WithdrawalReviewEnabled || networks[0].WithdrawalBroadcastEnabled {
		t.Fatalf("native route should fail closed: %+v", networks[0])
	}
	if networks[2].DepositEnabled || networks[2].WithdrawalEnabled || !networks[2].CrossChain {
		t.Fatalf("cross-chain route should fail closed: %+v", networks[2])
	}
}

func TestIndexerChainReaderUsesCommittedHeightAndExactUnitConversion(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /txs/aabbccddeeff0011", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"hash": "aabbccddeeff0011", "from": alice, "to": bob, "amount": 7, "blockNumber": 9})
	})
	mux.HandleFunc("GET /ynx/overview", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]any{"height": 11}) })
	server := httptest.NewServer(mux)
	defer server.Close()
	transfer, err := (IndexerChainReader{BaseURL: server.URL, Client: server.Client()}).Transfer("aabbccddeeff0011")
	if err != nil {
		t.Fatal(err)
	}
	if !transfer.Committed || transfer.Confirmations != 3 || transfer.AmountMicro != 7*AmountScale || transfer.To != bob {
		t.Fatalf("transfer=%+v", transfer)
	}
}
