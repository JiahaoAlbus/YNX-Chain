package exchangeproduct

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
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
	"github.com/gorilla/websocket"
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

type fixtureGateway struct{ session WalletSession }

func (f fixtureGateway) Authorize(token, scope, clientID string) (WalletSession, error) {
	if token != "central-ws-token" || clientID != "ynx-exchange-v1" {
		return WalletSession{}, ErrUnauthorized
	}
	for _, candidate := range f.session.Scopes {
		if candidate == scope {
			return f.session, nil
		}
	}
	return WalletSession{}, ErrForbidden
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
func placeWithPolicy(t *testing.T, s *Service, a testAccount, side string, price, amount int64, tif string, postOnly bool, key string) (Order, error) {
	t.Helper()
	req := PlaceOrderRequest{Market: DefaultMarket, Side: side, Type: "limit", TimeInForce: tif, PostOnly: postOnly, PriceMicro: price, AmountMicro: amount, IdempotencyKey: key}
	req.WalletSignature = signAction(a.private, OrderAuthorizationPayload(a.session.Account, req))
	return s.PlaceOrder(a.session, req)
}
func placeMarket(t *testing.T, s *Service, a testAccount, side string, protectionPrice, amount int64, key string) (Order, error) {
	t.Helper()
	req := PlaceOrderRequest{Market: DefaultMarket, Side: side, Type: "market", PriceMicro: protectionPrice, AmountMicro: amount, IdempotencyKey: key}
	req.WalletSignature = signAction(a.private, OrderAuthorizationPayload(a.session.Account, req))
	return s.PlaceOrder(a.session, req)
}
func createConditional(t *testing.T, s *Service, a testAccount, side, kind string, trigger, limit, amount int64, key string) (ConditionalOrder, error) {
	t.Helper()
	req := ConditionalOrderRequest{Market: DefaultMarket, Side: side, Kind: kind, TriggerPriceMicro: trigger, LimitPriceMicro: limit, AmountMicro: amount, IdempotencyKey: key}
	req.WalletSignature = signAction(a.private, ConditionalOrderAuthorizationPayload(a.account, req))
	return s.CreateConditionalOrder(a.session, req)
}
func createTrailing(t *testing.T, s *Service, a testAccount, side string, offset, limit, amount int64, key string) (ConditionalOrder, error) {
	t.Helper()
	req := ConditionalOrderRequest{Market: DefaultMarket, Side: side, Kind: "trailing", TrailOffsetMicro: offset, LimitPriceMicro: limit, AmountMicro: amount, IdempotencyKey: key}
	req.WalletSignature = signAction(a.private, ConditionalOrderAuthorizationPayload(a.account, req))
	return s.CreateConditionalOrder(a.session, req)
}
func createOCO(t *testing.T, s *Service, a testAccount, side string, stopTrigger, stopLimit, tpTrigger, tpLimit, amount int64, key string) (OCOGroup, error) {
	t.Helper()
	req := OCORequest{Market: DefaultMarket, Side: side, StopTriggerPriceMicro: stopTrigger, StopLimitPriceMicro: stopLimit, TakeProfitTriggerMicro: tpTrigger, TakeProfitLimitMicro: tpLimit, AmountMicro: amount, IdempotencyKey: key}
	req.WalletSignature = signAction(a.private, OCOAuthorizationPayload(a.account, req))
	return s.CreateOCO(a.session, req)
}
func createTWAP(t *testing.T, s *Service, a testAccount, side string, limit, total int64, slices int, interval int64, key string) (TWAPOrder, error) {
	t.Helper()
	req := TWAPRequest{Market: DefaultMarket, Side: side, LimitPriceMicro: limit, TotalAmountMicro: total, Slices: slices, IntervalSeconds: interval, IdempotencyKey: key}
	req.WalletSignature = signAction(a.private, TWAPAuthorizationPayload(a.account, req))
	return s.CreateTWAP(a.session, req)
}
func createIceberg(t *testing.T, s *Service, a testAccount, side string, price, total, display int64, postOnly bool, key string) (Order, error) {
	t.Helper()
	req := IcebergRequest{Market: DefaultMarket, Side: side, PriceMicro: price, TotalAmountMicro: total, DisplayAmountMicro: display, PostOnly: postOnly, IdempotencyKey: key}
	req.WalletSignature = signAction(a.private, IcebergAuthorizationPayload(a.account, req))
	return s.CreateIceberg(a.session, req)
}
func createScale(t *testing.T, s *Service, a testAccount, side string, start, end, total int64, levels int, postOnly bool, key string) (ScaleOrder, error) {
	t.Helper()
	req := ScaleRequest{Market: DefaultMarket, Side: side, StartPriceMicro: start, EndPriceMicro: end, TotalAmountMicro: total, Levels: levels, PostOnly: postOnly, IdempotencyKey: key}
	req.WalletSignature = signAction(a.private, ScaleAuthorizationPayload(a.account, req))
	return s.CreateScale(a.session, req)
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
	if sell.Status != "partially_filled" || sell.AmountMicro != 6*AmountScale || sell.FilledMicro != 0 || sell.Account != "" || sell.ReservedMicro != 0 || sell.AuthorizationDigest != "" {
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

func TestPostOnlyIOCAndFOKSemantics(t *testing.T) {
	s, chain, _ := newTestService(t)
	seller := accountSession(t, s, alice, "policy-seller", "exchange:read", "exchange:trade")
	buyer := accountSession(t, s, bob, "policy-buyer", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, seller, "abababababababab", 20*AmountScale)
	if _, err := s.CreditTestQuote(adminKey, bob, 100*AmountScale, "policy-credit-buyer"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, s, seller, "sell", 2*AmountScale, 5*AmountScale, "policy-maker-ask01"); err != nil {
		t.Fatal(err)
	}

	post, err := placeWithPolicy(t, s, buyer, "buy", 2*AmountScale, AmountScale, "gtc", true, "policy-post-only01")
	if err != nil || post.Status != "rejected" || post.RejectReason != "post_only_would_take" || post.FilledMicro != 0 || post.ReservedMicro != 0 {
		t.Fatalf("post-only=%+v err=%v", post, err)
	}
	fok, err := placeWithPolicy(t, s, buyer, "buy", 2*AmountScale, 6*AmountScale, "fok", false, "policy-fok-reject1")
	if err != nil || fok.Status != "rejected" || fok.RejectReason != "fok_not_fillable" || fok.FilledMicro != 0 || fok.ReservedMicro != 0 {
		t.Fatalf("fok reject=%+v err=%v", fok, err)
	}
	ioc, err := placeWithPolicy(t, s, buyer, "buy", 2*AmountScale, 7*AmountScale, "ioc", false, "policy-ioc-partial1")
	if err != nil || ioc.Status != "expired" || ioc.RejectReason != "ioc_remainder_cancelled" || ioc.FilledMicro != 5*AmountScale || ioc.ReservedMicro != 0 {
		t.Fatalf("ioc=%+v err=%v", ioc, err)
	}
	book := s.Book()
	if len(book.Bids) != 0 || len(book.Asks) != 0 {
		t.Fatalf("ioc remainder or filled maker remained on book: %+v", book)
	}
	assertLedgerBalances(t, s.Snapshot(alice))
	assertLedgerBalances(t, s.Snapshot(bob))

	if _, err := place(t, s, seller, "sell", 3*AmountScale, 2*AmountScale, "policy-maker-ask02"); err != nil {
		t.Fatal(err)
	}
	fok, err = placeWithPolicy(t, s, buyer, "buy", 3*AmountScale, 2*AmountScale, "fok", false, "policy-fok-filled1")
	if err != nil || fok.Status != "filled" || fok.FilledMicro != 2*AmountScale {
		t.Fatalf("fok fill=%+v err=%v", fok, err)
	}
}

func TestMassCancelIsDeterministicAtomicAndIdempotent(t *testing.T) {
	s, chain, _ := newTestService(t)
	a := accountSession(t, s, alice, "mass-cancel", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, a, "cdcdcdcdcdcdcdcd", 20*AmountScale)
	first, err := place(t, s, a, "sell", 3*AmountScale, 2*AmountScale, "mass-cancel-order1")
	if err != nil {
		t.Fatal(err)
	}
	second, err := place(t, s, a, "sell", 4*AmountScale, 3*AmountScale, "mass-cancel-order2")
	if err != nil {
		t.Fatal(err)
	}
	key := "mass-cancel-request1"
	sig := signAction(a.private, MassCancelAuthorizationPayload(a.account, DefaultMarket, key))
	cancelled, err := s.MassCancel(a.session, DefaultMarket, key, sig)
	if err != nil || cancelled.Count != 2 || len(cancelled.Orders) != 2 || cancelled.Orders[0].ID != first.ID || cancelled.Orders[1].ID != second.ID {
		t.Fatalf("mass cancel=%+v err=%v", cancelled, err)
	}
	for _, order := range cancelled.Orders {
		if order.Status != "cancelled" || order.ReservedMicro != 0 {
			t.Fatalf("order not atomically released: %+v", order)
		}
	}
	replay, err := s.MassCancel(a.session, DefaultMarket, key, sig)
	if err != nil || replay.Count != 2 || len(replay.Orders) != 2 || replay.Orders[0].ID != first.ID || replay.Orders[1].ID != second.ID {
		t.Fatalf("mass cancel replay=%+v err=%v", replay, err)
	}
	if len(s.Book().Asks) != 0 {
		t.Fatalf("cancelled orders remained on book: %+v", s.Book())
	}
	assertLedgerBalances(t, s.Snapshot(alice))
}

func TestMarketIOCUsesSignedPriceProtectionAndNeverRests(t *testing.T) {
	s, chain, _ := newTestService(t)
	seller := accountSession(t, s, alice, "market-seller", "exchange:read", "exchange:trade")
	buyer := accountSession(t, s, bob, "market-buyer", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, seller, "1212121212121212", 10*AmountScale)
	if _, err := s.CreditTestQuote(adminKey, bob, 50*AmountScale, "market-credit-buyer"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, s, seller, "sell", 3*AmountScale, 2*AmountScale, "market-maker-ask01"); err != nil {
		t.Fatal(err)
	}
	protected, err := placeMarket(t, s, buyer, "buy", 2*AmountScale, AmountScale, "market-protection01")
	if err != nil || protected.Status != "expired" || protected.FilledMicro != 0 || protected.ReservedMicro != 0 || protected.Type != "market" || protected.TimeInForce != "ioc" {
		t.Fatalf("protected market=%+v err=%v", protected, err)
	}
	partial, err := placeMarket(t, s, buyer, "buy", 3*AmountScale, 3*AmountScale, "market-partial-ioc")
	if err != nil || partial.Status != "expired" || partial.FilledMicro != 2*AmountScale || partial.ReservedMicro != 0 {
		t.Fatalf("partial market=%+v err=%v", partial, err)
	}
	book := s.Book()
	if len(book.Bids) != 0 || len(book.Asks) != 0 {
		t.Fatalf("market order or filled maker rested: %+v", book)
	}
	assertLedgerBalances(t, s.Snapshot(alice))
	assertLedgerBalances(t, s.Snapshot(bob))
}

func TestPublicBookUsesDeterministicPriceTimeIDPriority(t *testing.T) {
	s, chain, _ := newTestService(t)
	a := accountSession(t, s, alice, "book-priority", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, a, "3434343434343434", 20*AmountScale)
	first, err := place(t, s, a, "sell", 3*AmountScale, AmountScale, "book-priority-ask1")
	if err != nil {
		t.Fatal(err)
	}
	second, err := place(t, s, a, "sell", 3*AmountScale, AmountScale, "book-priority-ask2")
	if err != nil {
		t.Fatal(err)
	}
	better, err := place(t, s, a, "sell", 2*AmountScale, AmountScale, "book-priority-ask3")
	if err != nil {
		t.Fatal(err)
	}
	book := s.Book()
	if len(book.Asks) != 3 || book.Asks[0].ID != better.ID || book.Asks[1].ID != first.ID || book.Asks[2].ID != second.ID {
		t.Fatalf("book priority=%+v", book.Asks)
	}
}

func TestAtomicAmendResetsPriorityPreservesBalancesAndReplays(t *testing.T) {
	s, chain, _ := newTestService(t)
	aliceSeller := accountSession(t, s, alice, "amend-alice", "exchange:read", "exchange:trade")
	carolSeller := accountSession(t, s, carol, "amend-carol", "exchange:read", "exchange:trade")
	buyer := accountSession(t, s, bob, "amend-buyer", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, aliceSeller, "5656565656565656", 10*AmountScale)
	confirmDeposit(t, s, chain, carolSeller, "7878787878787878", 10*AmountScale)
	if _, err := s.CreditTestQuote(adminKey, bob, 20*AmountScale, "amend-buyer-credit"); err != nil {
		t.Fatal(err)
	}
	aliceOrder, err := place(t, s, aliceSeller, "sell", 2*AmountScale, 2*AmountScale, "amend-alice-order1")
	if err != nil {
		t.Fatal(err)
	}
	carolOrder, err := place(t, s, carolSeller, "sell", 2*AmountScale, 2*AmountScale, "amend-carol-order1")
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Millisecond)
	amend := AmendOrderRequest{PriceMicro: 2 * AmountScale, AmountMicro: 3 * AmountScale, TimeInForce: "gtc", IdempotencyKey: "amend-alice-request1"}
	amend.WalletSignature = signAction(aliceSeller.private, AmendOrderAuthorizationPayload(aliceSeller.account, aliceOrder.ID, amend))
	amended, err := s.AmendOrder(aliceSeller.session, aliceOrder.ID, amend)
	if err != nil || amended.AmountMicro != 3*AmountScale || amended.ReservedMicro != 3*AmountScale || !amended.CreatedAt.After(carolOrder.CreatedAt) {
		t.Fatalf("amended=%+v err=%v", amended, err)
	}
	replay, err := s.AmendOrder(aliceSeller.session, aliceOrder.ID, amend)
	if err != nil || replay.ID != amended.ID || replay.AmountMicro != amended.AmountMicro {
		t.Fatalf("amend replay=%+v err=%v", replay, err)
	}
	fill, err := place(t, s, buyer, "buy", 2*AmountScale, AmountScale, "amend-priority-fill")
	if err != nil || fill.Status != "filled" {
		t.Fatalf("fill=%+v err=%v", fill, err)
	}
	trades := s.Snapshot(bob).Trades
	if len(trades) != 1 || trades[0].Seller != carol || trades[0].SellOrderID != carolOrder.ID {
		t.Fatalf("amended order did not lose time priority: %+v", trades)
	}
	invalid := AmendOrderRequest{PriceMicro: 2 * AmountScale, AmountMicro: AmountScale, TimeInForce: "gtc", IdempotencyKey: "amend-carol-invalid"}
	invalid.WalletSignature = signAction(carolSeller.private, AmendOrderAuthorizationPayload(carolSeller.account, carolOrder.ID, invalid))
	if _, err := s.AmendOrder(carolSeller.session, carolOrder.ID, invalid); err != ErrInvalid {
		t.Fatalf("resize below/equal filled err=%v", err)
	}
	before := s.Snapshot(alice).Orders
	fok := AmendOrderRequest{PriceMicro: 2 * AmountScale, AmountMicro: 4 * AmountScale, TimeInForce: "fok", IdempotencyKey: "amend-alice-fok-no"}
	fok.WalletSignature = signAction(aliceSeller.private, AmendOrderAuthorizationPayload(aliceSeller.account, aliceOrder.ID, fok))
	if _, err := s.AmendOrder(aliceSeller.session, aliceOrder.ID, fok); err != ErrConflict {
		t.Fatalf("unfillable FOK amend err=%v", err)
	}
	after := s.Snapshot(alice).Orders
	if len(before) != len(after) || before[0].AmountMicro != after[0].AmountMicro || before[0].ReservedMicro != after[0].ReservedMicro {
		t.Fatalf("failed amend mutated order: before=%+v after=%+v", before, after)
	}
	assertLedgerBalances(t, s.Snapshot(alice))
	assertLedgerBalances(t, s.Snapshot(carol))
	assertLedgerBalances(t, s.Snapshot(bob))
}

func TestDeadManHeartbeatRestartExpiryAndRearm(t *testing.T) {
	now := time.Date(2026, 7, 22, 15, 0, 0, 0, time.UTC)
	chain := &fakeChain{transfers: map[string]ChainTransfer{}}
	path := filepath.Join(t.TempDir(), "dead-man-state.json")
	config := Config{StatePath: path, APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback", CustodyAddress: bob, IndexerURL: "https://indexer.test.invalid", RequiredConfirmations: 3, Chain: chain, Now: func() time.Time { return now }}
	s, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	a := accountSession(t, s, alice, "dead-man", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, a, "9090909090909090", 10*AmountScale)
	order, err := place(t, s, a, "sell", 3*AmountScale, 4*AmountScale, "dead-man-order-01")
	if err != nil || order.Status != "open" {
		t.Fatalf("order=%+v err=%v", order, err)
	}
	condition, err := createConditional(t, s, a, "sell", "take_profit", 5*AmountScale, 5*AmountScale, AmountScale, "dead-man-condition")
	if err != nil || condition.Status != "pending_trigger" {
		t.Fatalf("condition=%+v err=%v", condition, err)
	}
	arm := DeadManRequest{Action: "arm", TimeoutSeconds: 10, NonceDomain: "deadman:strategy-a", IdempotencyKey: "dead-man-arm-0001"}
	arm.WalletSignature = signAction(a.private, DeadManAuthorizationPayload(a.account, arm))
	armed, err := s.ConfigureDeadMan(a.session, arm)
	if err != nil || armed.Status != "active" || !armed.ExpiresAt.Equal(now.Add(10*time.Second)) {
		t.Fatalf("armed=%+v err=%v", armed, err)
	}
	now = now.Add(6 * time.Second)
	heartbeat := DeadManRequest{Action: "heartbeat", TimeoutSeconds: 10, NonceDomain: arm.NonceDomain, IdempotencyKey: "dead-man-heart-001"}
	heartbeat.WalletSignature = signAction(a.private, DeadManAuthorizationPayload(a.account, heartbeat))
	active, err := s.ConfigureDeadMan(a.session, heartbeat)
	if err != nil || !active.ExpiresAt.Equal(now.Add(10*time.Second)) {
		t.Fatalf("heartbeat=%+v err=%v", active, err)
	}
	now = now.Add(5 * time.Second)
	if cancelled, err := s.SweepDeadMan(); err != nil || cancelled != 0 || len(s.Book().Asks) != 1 {
		t.Fatalf("premature sweep cancelled=%d err=%v book=%+v", cancelled, err, s.Book())
	}
	restarted, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	if state := restarted.Snapshot(alice).DeadMan; state.Status != "active" || state.NonceDomain != arm.NonceDomain {
		t.Fatalf("dead-man not restored: %+v", state)
	}
	now = now.Add(6 * time.Second)
	cancelled, err := restarted.SweepDeadMan()
	if err != nil || cancelled != 2 || len(restarted.Book().Asks) != 0 {
		t.Fatalf("expiry sweep cancelled=%d err=%v book=%+v", cancelled, err, restarted.Book())
	}
	snapshot := restarted.Snapshot(alice)
	if snapshot.DeadMan.Status != "expired" || snapshot.DeadMan.Cancelled != 2 || snapshot.Orders[0].Status != "cancelled" || snapshot.Orders[0].RejectReason != "dead_man_expired" || snapshot.Orders[0].ReservedMicro != 0 || len(snapshot.ConditionalOrders) != 1 || snapshot.ConditionalOrders[0].Status != "cancelled" || snapshot.ConditionalOrders[0].RejectReason != "dead_man_expired" || snapshot.ConditionalOrders[0].ReservedMicro != 0 {
		t.Fatalf("expired snapshot=%+v", snapshot)
	}
	if _, err := place(t, restarted, a, "sell", 4*AmountScale, AmountScale, "dead-man-blocked-1"); err != ErrForbidden {
		t.Fatalf("expired switch allowed new order: %v", err)
	}
	rearm := DeadManRequest{Action: "arm", TimeoutSeconds: 30, NonceDomain: "deadman:strategy-a:rearmed", IdempotencyKey: "dead-man-rearm-01"}
	rearm.WalletSignature = signAction(a.private, DeadManAuthorizationPayload(a.account, rearm))
	if state, err := restarted.ConfigureDeadMan(a.session, rearm); err != nil || state.Status != "active" {
		t.Fatalf("rearm=%+v err=%v", state, err)
	}
	if _, err := place(t, restarted, a, "sell", 4*AmountScale, AmountScale, "dead-man-after-arm"); err != nil {
		t.Fatalf("rearmed order err=%v", err)
	}
	disarm := DeadManRequest{Action: "disarm", NonceDomain: rearm.NonceDomain, IdempotencyKey: "dead-man-disarm01"}
	disarm.WalletSignature = signAction(a.private, DeadManAuthorizationPayload(a.account, disarm))
	if state, err := restarted.ConfigureDeadMan(a.session, disarm); err != nil || state.Status != "disarmed" {
		t.Fatalf("disarm=%+v err=%v", state, err)
	}
	now = now.Add(time.Hour)
	if cancelled, err := restarted.SweepDeadMan(); err != nil || cancelled != 0 || len(restarted.Book().Asks) != 1 {
		t.Fatalf("disarmed sweep cancelled=%d err=%v", cancelled, err)
	}
	assertLedgerBalances(t, restarted.Snapshot(alice))
}

func TestStateSchemaV1MigratesToCurrentAfterLegacyIntegrityVerification(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy-v1.json")
	legacy := legacyStateV1(newState())
	legacy.SchemaVersion = 1
	var err error
	legacy.IntegrityHash, err = legacyStateIntegrityV1(legacy)
	if err != nil {
		t.Fatal(err)
	}
	legacyJSON, err := json.MarshalIndent(legacy, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, legacyJSON, 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := New(Config{StatePath: path, APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback"})
	if err != nil {
		t.Fatal(err)
	}
	if s.state.SchemaVersion != currentStateSchemaVersion || s.state.DeadMan == nil {
		t.Fatalf("migration state schema=%d deadMan=%v", s.state.SchemaVersion, s.state.DeadMan)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var persisted persistentState
	if json.Unmarshal(b, &persisted) != nil || persisted.SchemaVersion != currentStateSchemaVersion || persisted.IntegrityHash == "" {
		t.Fatalf("persisted migration=%+v", persisted)
	}
	expected, err := stateIntegrity(persisted)
	if err != nil || expected != persisted.IntegrityHash {
		t.Fatalf("migrated integrity expected=%s actual=%s err=%v", expected, persisted.IntegrityHash, err)
	}
}

func TestStopAndTakeProfitUseOnlyActualTradeTriggersAndReserveSafely(t *testing.T) {
	s, chain, _ := newTestService(t)
	conditionalSeller := accountSession(t, s, alice, "conditional-alice", "exchange:read", "exchange:trade")
	maker := accountSession(t, s, carol, "conditional-carol", "exchange:read", "exchange:trade")
	buyer := accountSession(t, s, bob, "conditional-bob", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, conditionalSeller, "c3c3c3c3c3c3c3c3", 10*AmountScale)
	confirmDeposit(t, s, chain, maker, "d4d4d4d4d4d4d4d4", 10*AmountScale)
	if _, err := s.CreditTestQuote(adminKey, bob, 50*AmountScale, "conditional-buyer-credit"); err != nil {
		t.Fatal(err)
	}
	stop, err := createConditional(t, s, conditionalSeller, "sell", "stop", 2*AmountScale, 2*AmountScale, 2*AmountScale, "conditional-stop-01")
	if err != nil || stop.Status != "pending_trigger" || stop.ReservedMicro != 2*AmountScale {
		t.Fatalf("stop=%+v err=%v", stop, err)
	}
	if _, err := place(t, s, maker, "sell", 3*AmountScale, AmountScale, "conditional-maker-3"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, s, buyer, "buy", 3*AmountScale, AmountScale, "conditional-trade-3"); err != nil {
		t.Fatal(err)
	}
	if got := s.Snapshot(alice).ConditionalOrders[0]; got.Status != "pending_trigger" || got.TriggeredByTradeID != "" {
		t.Fatalf("non-triggering actual trade changed stop: %+v", got)
	}
	if _, err := place(t, s, maker, "sell", 2*AmountScale, AmountScale, "conditional-maker-2"); err != nil {
		t.Fatal(err)
	}
	triggeringBuy, err := place(t, s, buyer, "buy", 2*AmountScale, 3*AmountScale, "conditional-trade-2")
	if err != nil || triggeringBuy.Status != "filled" {
		t.Fatalf("triggering buy=%+v err=%v", triggeringBuy, err)
	}
	snapshot := s.Snapshot(alice)
	if len(snapshot.ConditionalOrders) != 1 || snapshot.ConditionalOrders[0].Status != "triggered" || snapshot.ConditionalOrders[0].TriggeredByTradeID == "" || snapshot.ConditionalOrders[0].ActivatedOrderID == "" || snapshot.ConditionalOrders[0].ReservedMicro != 0 {
		t.Fatalf("triggered conditional=%+v", snapshot.ConditionalOrders)
	}
	if len(snapshot.Orders) != 1 || snapshot.Orders[0].ID != snapshot.ConditionalOrders[0].ActivatedOrderID || snapshot.Orders[0].Status != "filled" || snapshot.Orders[0].FilledMicro != 2*AmountScale || snapshot.Orders[0].ReservedMicro != 0 {
		t.Fatalf("activated order=%+v", snapshot.Orders)
	}
	tp, err := createConditional(t, s, conditionalSeller, "sell", "take_profit", 4*AmountScale, 4*AmountScale, AmountScale, "conditional-tp-001")
	if err != nil || tp.Status != "pending_trigger" {
		t.Fatalf("take profit=%+v err=%v", tp, err)
	}
	key := "conditional-cancel1"
	sig := signAction(conditionalSeller.private, ConditionalCancelAuthorizationPayload(alice, tp.ID, key))
	cancelled, err := s.CancelConditionalOrder(conditionalSeller.session, tp.ID, key, sig)
	if err != nil || cancelled.Status != "cancelled" || cancelled.ReservedMicro != 0 {
		t.Fatalf("conditional cancel=%+v err=%v", cancelled, err)
	}
	assertLedgerBalances(t, s.Snapshot(alice))
	assertLedgerBalances(t, s.Snapshot(carol))
	assertLedgerBalances(t, s.Snapshot(bob))
}

func TestTrailingUsesPersistedTradeWatermarkAndTriggersOnReversal(t *testing.T) {
	s, chain, _ := newTestService(t)
	trailingSeller := accountSession(t, s, alice, "trailing-alice", "exchange:read", "exchange:trade")
	maker := accountSession(t, s, carol, "trailing-carol", "exchange:read", "exchange:trade")
	buyer := accountSession(t, s, bob, "trailing-bob", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, trailingSeller, "e5e5e5e5e5e5e5e5", 10*AmountScale)
	confirmDeposit(t, s, chain, maker, "f6f6f6f6f6f6f6f6", 10*AmountScale)
	if _, err := s.CreditTestQuote(adminKey, bob, 100*AmountScale, "trailing-buyer-credit"); err != nil {
		t.Fatal(err)
	}
	if _, err := createTrailing(t, s, trailingSeller, "sell", AmountScale, 3*AmountScale, 2*AmountScale, "trailing-no-source"); err != ErrUnavailable {
		t.Fatalf("trailing without actual match err=%v", err)
	}
	if _, err := place(t, s, maker, "sell", 3*AmountScale, AmountScale, "trailing-maker-3a"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, s, buyer, "buy", 3*AmountScale, AmountScale, "trailing-trade-3a"); err != nil {
		t.Fatal(err)
	}
	trailing, err := createTrailing(t, s, trailingSeller, "sell", AmountScale, 3*AmountScale, 2*AmountScale, "trailing-sell-001")
	if err != nil || trailing.WatermarkMicro != 3*AmountScale || trailing.TriggerPriceMicro != 2*AmountScale || trailing.Status != "pending_trigger" {
		t.Fatalf("trailing=%+v err=%v", trailing, err)
	}
	if _, err := place(t, s, maker, "sell", 4*AmountScale, AmountScale, "trailing-maker-4"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, s, buyer, "buy", 4*AmountScale, AmountScale, "trailing-trade-4"); err != nil {
		t.Fatal(err)
	}
	updated := s.Snapshot(alice).ConditionalOrders[0]
	if updated.Status != "pending_trigger" || updated.WatermarkMicro != 4*AmountScale || updated.TriggerPriceMicro != 3*AmountScale {
		t.Fatalf("trailing watermark=%+v", updated)
	}
	if _, err := place(t, s, maker, "sell", 3*AmountScale, AmountScale, "trailing-maker-3b"); err != nil {
		t.Fatal(err)
	}
	buy, err := place(t, s, buyer, "buy", 3*AmountScale, 3*AmountScale, "trailing-reversal-3")
	if err != nil || buy.Status != "filled" {
		t.Fatalf("reversal buy=%+v err=%v", buy, err)
	}
	snapshot := s.Snapshot(alice)
	if snapshot.ConditionalOrders[0].Status != "triggered" || snapshot.ConditionalOrders[0].TriggeredByTradeID == "" || len(snapshot.Orders) != 1 || snapshot.Orders[0].Status != "filled" || snapshot.Orders[0].FilledMicro != 2*AmountScale {
		t.Fatalf("trailing activation conditional=%+v orders=%+v", snapshot.ConditionalOrders, snapshot.Orders)
	}
	assertLedgerBalances(t, snapshot)
}

func TestOCOUsesSingleReserveAndAtomicallyCancelsPeer(t *testing.T) {
	s, chain, _ := newTestService(t)
	owner := accountSession(t, s, alice, "oco-alice", "exchange:read", "exchange:trade")
	maker := accountSession(t, s, carol, "oco-carol", "exchange:read", "exchange:trade")
	buyer := accountSession(t, s, bob, "oco-bob", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, owner, "1717171717171717", 10*AmountScale)
	confirmDeposit(t, s, chain, maker, "1818181818181818", 10*AmountScale)
	if _, err := s.CreditTestQuote(adminKey, bob, 100*AmountScale, "oco-buyer-credit"); err != nil {
		t.Fatal(err)
	}
	group, err := createOCO(t, s, owner, "sell", 2*AmountScale, 2*AmountScale, 4*AmountScale, 4*AmountScale, 2*AmountScale, "oco-sell-group-01")
	if err != nil || group.Status != "pending_trigger" || group.ReservedMicro != 2*AmountScale {
		t.Fatalf("group=%+v err=%v", group, err)
	}
	initial := s.Snapshot(alice)
	if initial.Balances[0].ReservedMicro != 2*AmountScale || len(initial.ConditionalOrders) != 2 || initial.ConditionalOrders[0].ReservedMicro != 0 || initial.ConditionalOrders[1].ReservedMicro != 0 {
		t.Fatalf("OCO did not use one shared reserve: %+v", initial)
	}
	if _, err := place(t, s, maker, "sell", 4*AmountScale, AmountScale, "oco-maker-four"); err != nil {
		t.Fatal(err)
	}
	buy, err := place(t, s, buyer, "buy", 4*AmountScale, 3*AmountScale, "oco-trigger-four")
	if err != nil || buy.Status != "filled" {
		t.Fatalf("buy=%+v err=%v", buy, err)
	}
	snapshot := s.Snapshot(alice)
	if len(snapshot.OCOGroups) != 1 || snapshot.OCOGroups[0].Status != "triggered" || snapshot.OCOGroups[0].ReservedMicro != 0 || snapshot.OCOGroups[0].TriggeredConditionalID != snapshot.OCOGroups[0].TakeProfitConditionalID || snapshot.OCOGroups[0].ActivatedOrderID == "" {
		t.Fatalf("triggered group=%+v", snapshot.OCOGroups)
	}
	legs := map[string]ConditionalOrder{}
	for _, leg := range snapshot.ConditionalOrders {
		legs[leg.ID] = leg
	}
	if legs[group.TakeProfitConditionalID].Status != "triggered" || legs[group.StopConditionalID].Status != "cancelled" || legs[group.StopConditionalID].RejectReason != "oco_peer_triggered" {
		t.Fatalf("OCO legs=%+v", legs)
	}
	if len(snapshot.Orders) != 1 || snapshot.Orders[0].Status != "filled" || snapshot.Orders[0].FilledMicro != 2*AmountScale {
		t.Fatalf("OCO activated order=%+v", snapshot.Orders)
	}
	second, err := createOCO(t, s, owner, "sell", 2*AmountScale, 2*AmountScale, 5*AmountScale, 5*AmountScale, AmountScale, "oco-cancel-group")
	if err != nil {
		t.Fatal(err)
	}
	key := "oco-cancel-by-leg"
	sig := signAction(owner.private, ConditionalCancelAuthorizationPayload(alice, second.StopConditionalID, key))
	if _, err := s.CancelConditionalOrder(owner.session, second.StopConditionalID, key, sig); err != nil {
		t.Fatal(err)
	}
	afterCancel := s.Snapshot(alice)
	groups := map[string]OCOGroup{}
	for _, item := range afterCancel.OCOGroups {
		groups[item.ID] = item
	}
	if groups[second.ID].Status != "cancelled" || groups[second.ID].ReservedMicro != 0 {
		t.Fatalf("cancelled group=%+v", groups[second.ID])
	}
	assertLedgerBalances(t, afterCancel)
}

func TestTWAPPersistsScheduleExecutesIOCSlicesAndCancelsRemainder(t *testing.T) {
	now := time.Date(2026, 7, 22, 16, 0, 0, 0, time.UTC)
	chain := &fakeChain{transfers: map[string]ChainTransfer{}}
	path := filepath.Join(t.TempDir(), "twap-state.json")
	config := Config{StatePath: path, APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback", CustodyAddress: bob, IndexerURL: "https://indexer.test.invalid", RequiredConfirmations: 3, Chain: chain, Now: func() time.Time { return now }}
	s, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	seller := accountSession(t, s, alice, "twap-seller", "exchange:read", "exchange:trade")
	buyer := accountSession(t, s, bob, "twap-buyer", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, seller, "1919191919191919", 10*AmountScale)
	if _, err := s.CreditTestQuote(adminKey, bob, 100*AmountScale, "twap-buyer-credit"); err != nil {
		t.Fatal(err)
	}
	twap, err := createTWAP(t, s, seller, "sell", 2*AmountScale, 6*AmountScale, 3, 10, "twap-sell-plan-1")
	if err != nil || twap.Status != "scheduled" || twap.ReservedMicro != 6*AmountScale || !twap.NextRunAt.Equal(now) {
		t.Fatalf("twap=%+v err=%v", twap, err)
	}
	for slice := 0; slice < 3; slice++ {
		if _, err := place(t, s, buyer, "buy", 2*AmountScale, 2*AmountScale, fmt.Sprintf("twap-buyer-slice-%d", slice)); err != nil {
			t.Fatal(err)
		}
		executed, err := s.TickTWAP()
		if err != nil || executed != 1 {
			t.Fatalf("slice %d executed=%d err=%v", slice, executed, err)
		}
		state := s.Snapshot(alice).TWAPOrders[0]
		if state.SlicesExecuted != slice+1 || state.ScheduledMicro != int64(slice+1)*2*AmountScale || len(state.ChildOrderIDs) != slice+1 {
			t.Fatalf("slice %d state=%+v", slice, state)
		}
		if slice == 0 {
			restarted, err := New(config)
			if err != nil {
				t.Fatal(err)
			}
			s = restarted
			if executed, err := s.TickTWAP(); err != nil || executed != 0 {
				t.Fatalf("restart executed early=%d err=%v", executed, err)
			}
		}
		if slice < 2 {
			now = now.Add(10 * time.Second)
		}
	}
	state := s.Snapshot(alice)
	if state.TWAPOrders[0].Status != "completed" || state.TWAPOrders[0].ReservedMicro != 0 || len(state.Orders) != 3 {
		t.Fatalf("completed TWAP=%+v orders=%+v", state.TWAPOrders, state.Orders)
	}
	for _, child := range state.Orders {
		if child.Type != "twap_child" || child.TimeInForce != "ioc" || child.Status != "filled" || child.FilledMicro != 2*AmountScale {
			t.Fatalf("TWAP child=%+v", child)
		}
	}
	cancellable, err := createTWAP(t, s, seller, "sell", 3*AmountScale, 2*AmountScale, 2, 60, "twap-cancel-plan")
	if err != nil {
		t.Fatal(err)
	}
	key := "twap-cancel-request"
	sig := signAction(seller.private, TWAPCancelAuthorizationPayload(alice, cancellable.ID, key))
	cancelled, err := s.CancelTWAP(seller.session, cancellable.ID, key, sig)
	if err != nil || cancelled.Status != "cancelled" || cancelled.ReservedMicro != 0 {
		t.Fatalf("cancelled TWAP=%+v err=%v", cancelled, err)
	}
	assertLedgerBalances(t, s.Snapshot(alice))
	assertLedgerBalances(t, s.Snapshot(bob))
}

func TestIcebergHidesRemainderReplenishesBehindQueuePersistsAndCancels(t *testing.T) {
	now := time.Date(2026, 7, 22, 18, 0, 0, 0, time.UTC)
	chain := &fakeChain{transfers: map[string]ChainTransfer{}}
	path := filepath.Join(t.TempDir(), "iceberg-state.json")
	config := Config{StatePath: path, APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback", CustodyAddress: bob, IndexerURL: "https://indexer.test.invalid", RequiredConfirmations: 3, Chain: chain, Now: func() time.Time { return now }}
	s, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	icebergOwner := accountSession(t, s, alice, "iceberg-owner", "exchange:read", "exchange:trade")
	queuedSeller := accountSession(t, s, carol, "iceberg-queue", "exchange:read", "exchange:trade")
	buyer := accountSession(t, s, bob, "iceberg-buyer", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, icebergOwner, "2121212121212121", 10*AmountScale)
	confirmDeposit(t, s, chain, queuedSeller, "2222222222222222", 4*AmountScale)
	if _, err := s.CreditTestQuote(adminKey, bob, 100*AmountScale, "iceberg-buyer-credit"); err != nil {
		t.Fatal(err)
	}
	iceberg, err := createIceberg(t, s, icebergOwner, "sell", 2*AmountScale, 6*AmountScale, 2*AmountScale, false, "iceberg-sell-1")
	if err != nil || iceberg.ReservedMicro != 6*AmountScale || iceberg.VisibleUntilMicro != 2*AmountScale {
		t.Fatalf("iceberg=%+v err=%v", iceberg, err)
	}
	queued, err := place(t, s, queuedSeller, "sell", 2*AmountScale, 2*AmountScale, "iceberg-queued-seller")
	if err != nil {
		t.Fatal(err)
	}
	book := s.Book()
	if len(book.Asks) != 2 || book.Asks[0].ID != iceberg.ID || book.Asks[0].AmountMicro != 2*AmountScale || book.Asks[0].Account != "" || book.Asks[0].AuthorizationDigest != "" || book.Asks[0].ReservedMicro != 0 {
		t.Fatalf("initial public book leaks or priority wrong: %+v", book.Asks)
	}
	if _, err := place(t, s, buyer, "buy", 2*AmountScale, 2*AmountScale, "iceberg-fill-first-display"); err != nil {
		t.Fatal(err)
	}
	book = s.Book()
	if len(book.Asks) != 2 || book.Asks[0].ID != queued.ID || book.Asks[1].ID != iceberg.ID || book.Asks[1].AmountMicro != 2*AmountScale {
		t.Fatalf("replenished iceberg retained queue priority or leaked hidden amount: %+v", book.Asks)
	}
	marketStream, err := s.StreamSnapshot("market", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range marketStream.Events {
		if event.ObjectID != iceberg.ID {
			continue
		}
		var payload struct {
			AmountMicro int64 `json:"AmountMicro"`
		}
		if err := json.Unmarshal(event.Payload, &payload); err != nil || payload.AmountMicro > 2*AmountScale {
			t.Fatalf("market stream leaked hidden iceberg amount: event=%+v payload=%+v err=%v", event, payload, err)
		}
	}
	restarted, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	s = restarted
	book = s.Book()
	if len(book.Asks) != 2 || book.Asks[0].ID != queued.ID || book.Asks[1].ID != iceberg.ID {
		t.Fatalf("restart changed queue: %+v", book.Asks)
	}
	if _, err := place(t, s, buyer, "buy", 2*AmountScale, 2*AmountScale, "iceberg-fill-queued"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, s, buyer, "buy", 2*AmountScale, 4*AmountScale, "iceberg-fill-rest"); err != nil {
		t.Fatal(err)
	}
	ownerState := s.Snapshot(alice)
	if len(ownerState.Orders) != 1 || ownerState.Orders[0].Status != "filled" || ownerState.Orders[0].FilledMicro != 6*AmountScale || ownerState.Orders[0].ReservedMicro != 0 || len(ownerState.Trades) != 3 {
		t.Fatalf("filled iceberg state=%+v", ownerState)
	}
	cancellable, err := createIceberg(t, s, icebergOwner, "sell", 3*AmountScale, 2*AmountScale, AmountScale, true, "iceberg-cancel-open")
	if err != nil {
		t.Fatal(err)
	}
	key := "iceberg-cancel-key"
	payload := []byte(strings.Join([]string{"ynx-exchange-cancel-v1", alice, cancellable.ID, key}, "\n"))
	cancelled, err := s.CancelOrder(icebergOwner.session, cancellable.ID, key, signAction(icebergOwner.private, payload))
	if err != nil || cancelled.Status != "cancelled" || cancelled.ReservedMicro != 0 {
		t.Fatalf("cancelled iceberg=%+v err=%v", cancelled, err)
	}
	assertLedgerBalances(t, s.Snapshot(alice))
	assertLedgerBalances(t, s.Snapshot(bob))
	assertLedgerBalances(t, s.Snapshot(carol))
}

func TestScaleAtomicallyCreatesLevelsPersistsFillsCancelsAndFailsWithoutMutation(t *testing.T) {
	now := time.Date(2026, 7, 23, 1, 0, 0, 0, time.UTC)
	chain := &fakeChain{transfers: map[string]ChainTransfer{}}
	path := filepath.Join(t.TempDir(), "scale-state.json")
	config := Config{StatePath: path, APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback", CustodyAddress: bob, IndexerURL: "https://indexer.test.invalid", RequiredConfirmations: 3, Chain: chain, Now: func() time.Time { return now }}
	s, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	seller := accountSession(t, s, alice, "scale-seller", "exchange:read", "exchange:trade")
	buyer := accountSession(t, s, bob, "scale-buyer", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, seller, "2323232323232323", 12*AmountScale)
	if _, err := s.CreditTestQuote(adminKey, bob, 100*AmountScale, "scale-buyer-credit"); err != nil {
		t.Fatal(err)
	}
	scale, err := createScale(t, s, seller, "sell", 2*AmountScale, 4*AmountScale, 6*AmountScale, 3, true, "scale-sell-plan-1")
	if err != nil || scale.Status != "open" || scale.ReservedMicro != 6*AmountScale || len(scale.ChildOrderIDs) != 3 {
		t.Fatalf("scale=%+v err=%v", scale, err)
	}
	replayed, err := createScale(t, s, seller, "sell", 2*AmountScale, 4*AmountScale, 6*AmountScale, 3, true, "scale-sell-plan-1")
	if err != nil || replayed.ID != scale.ID {
		t.Fatalf("scale replay=%+v err=%v", replayed, err)
	}
	book := s.Book()
	if len(book.Asks) != 3 || book.Asks[0].PriceMicro != 2*AmountScale || book.Asks[1].PriceMicro != 3*AmountScale || book.Asks[2].PriceMicro != 4*AmountScale {
		t.Fatalf("scale book=%+v", book.Asks)
	}
	for _, child := range book.Asks {
		if child.Type != "scale_child" || child.AmountMicro != 2*AmountScale || child.Account != "" || child.ReservedMicro != 0 {
			t.Fatalf("scale public child=%+v", child)
		}
	}
	restarted, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	s = restarted
	if _, err := place(t, s, buyer, "buy", 3*AmountScale, 3*AmountScale, "scale-partial-fill"); err != nil {
		t.Fatal(err)
	}
	state := s.Snapshot(alice)
	if len(state.ScaleOrders) != 1 || state.ScaleOrders[0].Status != "partially_filled" || state.ScaleOrders[0].FilledMicro != 3*AmountScale || state.ScaleOrders[0].ReservedMicro != 3*AmountScale {
		t.Fatalf("partial scale state=%+v", state.ScaleOrders)
	}
	key := "scale-cancel-plan"
	sig := signAction(seller.private, ScaleCancelAuthorizationPayload(alice, scale.ID, key))
	cancelled, err := s.CancelScale(seller.session, scale.ID, key, sig)
	if err != nil || cancelled.Status != "partially_cancelled" || cancelled.FilledMicro != 3*AmountScale || cancelled.ReservedMicro != 0 || len(s.Book().Asks) != 0 {
		t.Fatalf("cancelled scale=%+v book=%+v err=%v", cancelled, s.Book(), err)
	}
	before := s.Snapshot(alice)
	stateDigestBefore := digest(s.state)
	sequenceBefore := s.state.Sequence
	if _, err := createScale(t, s, seller, "sell", 5*AmountScale, 6*AmountScale, 10*AmountScale, 2, true, "scale-insufficient-atomic"); err != ErrInsufficient {
		t.Fatalf("insufficient scale err=%v", err)
	}
	after := s.Snapshot(alice)
	if digest(s.state) != stateDigestBefore || s.state.Sequence != sequenceBefore {
		t.Fatalf("failed scale mutated state\nbefore=%+v\nafter=%+v", before, after)
	}
	assertLedgerBalances(t, after)
	assertLedgerBalances(t, s.Snapshot(bob))
}

func TestDeadManCancelsScaleAsOnePlanAndReleasesAllChildren(t *testing.T) {
	now := time.Date(2026, 7, 23, 2, 0, 0, 0, time.UTC)
	chain := &fakeChain{transfers: map[string]ChainTransfer{}}
	config := Config{StatePath: filepath.Join(t.TempDir(), "scale-dead-man.json"), APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback", CustodyAddress: bob, IndexerURL: "https://indexer.test.invalid", RequiredConfirmations: 3, Chain: chain, Now: func() time.Time { return now }}
	s, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	owner := accountSession(t, s, alice, "scale-dead-man-owner", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, owner, "2424242424242424", 4*AmountScale)
	scale, err := createScale(t, s, owner, "sell", 3*AmountScale, 4*AmountScale, 2*AmountScale, 2, true, "scale-dead-man-plan")
	if err != nil {
		t.Fatal(err)
	}
	arm := DeadManRequest{Action: "arm", TimeoutSeconds: 5, NonceDomain: "deadman:scale-plan", IdempotencyKey: "scale-dead-man-arm"}
	arm.WalletSignature = signAction(owner.private, DeadManAuthorizationPayload(alice, arm))
	if _, err := s.ConfigureDeadMan(owner.session, arm); err != nil {
		t.Fatal(err)
	}
	now = now.Add(5 * time.Second)
	cancelled, err := s.SweepDeadMan()
	if err != nil || cancelled != 1 {
		t.Fatalf("dead-man cancelled=%d err=%v", cancelled, err)
	}
	state := s.Snapshot(alice)
	if len(state.ScaleOrders) != 1 || state.ScaleOrders[0].ID != scale.ID || state.ScaleOrders[0].Status != "cancelled" || state.ScaleOrders[0].ReservedMicro != 0 || state.DeadMan.Cancelled != 1 || len(s.Book().Asks) != 0 {
		t.Fatalf("dead-man scale state=%+v", state)
	}
	for _, child := range state.Orders {
		if child.Status != "cancelled" || child.ReservedMicro != 0 || child.RejectReason != "dead_man_expired" {
			t.Fatalf("dead-man child=%+v", child)
		}
	}
	assertLedgerBalances(t, state)
}

func TestExecutionSequenceReplayRestartFilteringAndChainTamper(t *testing.T) {
	s, chain, path := newTestService(t)
	seller := accountSession(t, s, alice, "stream-seller", "exchange:read", "exchange:trade")
	buyer := accountSession(t, s, bob, "stream-buyer", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, seller, "a1a1a1a1a1a1a1a1", 10*AmountScale)
	if _, err := s.CreditTestQuote(adminKey, bob, 20*AmountScale, "stream-credit-buyer"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, s, seller, "sell", 2*AmountScale, 2*AmountScale, "stream-seller-order"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, s, buyer, "buy", 2*AmountScale, AmountScale, "stream-buyer-order"); err != nil {
		t.Fatal(err)
	}
	market, current, err := s.ExecutionEvents(0, "market", "", 1000)
	if err != nil || len(market) < 4 || current < market[len(market)-1].Sequence {
		t.Fatalf("market events=%+v current=%d err=%v", market, current, err)
	}
	previous := ""
	last := int64(0)
	for _, event := range s.state.ExecutionEvents {
		if event.Sequence <= last || event.PreviousHash != previous || event.Hash == "" || len(event.Payload) == 0 {
			t.Fatalf("invalid event chain at %+v", event)
		}
		last, previous = event.Sequence, event.Hash
		if event.Stream == "market" && (strings.Contains(string(event.Payload), alice) || strings.Contains(string(event.Payload), bob) || strings.Contains(string(event.Payload), "authorizationDigest")) {
			t.Fatalf("market payload leaked account/action authorization: %s", event.Payload)
		}
	}
	aliceEvents, _, err := s.ExecutionEvents(0, "user", alice, 1000)
	if err != nil || len(aliceEvents) == 0 {
		t.Fatalf("alice events=%+v err=%v", aliceEvents, err)
	}
	for _, event := range aliceEvents {
		if event.Account != alice {
			t.Fatalf("cross-account event leaked: %+v", event)
		}
	}
	replayed, _, err := s.ExecutionEvents(market[0].Sequence, "market", "", 1000)
	if err != nil || len(replayed) != len(market)-1 || replayed[0].Sequence <= market[0].Sequence {
		t.Fatalf("replay=%+v err=%v", replayed, err)
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	afterRestart, sequence, err := restarted.ExecutionEvents(0, "market", "", 1000)
	if err != nil || len(afterRestart) != len(market) || sequence != current {
		t.Fatalf("restart events=%d/%d sequence=%d/%d err=%v", len(afterRestart), len(market), sequence, current, err)
	}
	restarted.state.ExecutionEvents[0].PayloadDigest = strings.Repeat("0", 64)
	if err := saveState(path, &restarted.state); err != nil {
		t.Fatal(err)
	}
	if _, err := New(s.cfg); err == nil || !strings.Contains(err.Error(), "execution event") {
		t.Fatalf("tampered event chain accepted: %v", err)
	}
}

func TestMarketWebSocketSnapshotLiveSequenceAndUserQueryTokenRejection(t *testing.T) {
	s, chain, _ := newTestService(t)
	a := accountSession(t, s, alice, "ws-market", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, a, "b2b2b2b2b2b2b2b2", 10*AmountScale)
	server := httptest.NewServer(NewServer(s))
	defer server.Close()
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/v1/ws/market"
	conn, response, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("websocket dial response=%v err=%v", response, err)
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	var snapshot struct {
		Type     string `json:"type"`
		Snapshot struct {
			Sequence int64 `json:"sequence"`
		} `json:"snapshot"`
	}
	if conn.ReadJSON(&snapshot) != nil || snapshot.Type != "snapshot" {
		t.Fatalf("snapshot=%+v", snapshot)
	}
	if _, err := place(t, s, a, "sell", 3*AmountScale, AmountScale, "ws-live-order-01"); err != nil {
		t.Fatal(err)
	}
	var live struct {
		Type  string         `json:"type"`
		Event ExecutionEvent `json:"event"`
	}
	if err := conn.ReadJSON(&live); err != nil || live.Type != "event" || live.Event.Sequence <= snapshot.Snapshot.Sequence || live.Event.Stream != "market" {
		t.Fatalf("live=%+v err=%v", live, err)
	}
	s.cfg.Gateway = fixtureGateway{session: a.session}
	s.cfg.GatewayClientID = "ynx-exchange-v1"
	userURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/v1/ws/user"
	header := http.Header{"Authorization": []string{"Bearer central-ws-token"}}
	user, response, err := websocket.DefaultDialer.Dial(userURL, header)
	if err != nil {
		t.Fatalf("user websocket response=%v err=%v", response, err)
	}
	defer user.Close()
	_ = user.SetReadDeadline(time.Now().Add(5 * time.Second))
	var userSnapshot struct {
		Type     string `json:"type"`
		Snapshot struct {
			Sequence int64 `json:"sequence"`
		} `json:"snapshot"`
	}
	if err := user.ReadJSON(&userSnapshot); err != nil || userSnapshot.Type != "snapshot" {
		t.Fatalf("user snapshot=%+v err=%v", userSnapshot, err)
	}
	second, err := place(t, s, a, "sell", 4*AmountScale, AmountScale, "ws-user-order-001")
	if err != nil {
		t.Fatal(err)
	}
	var userLive struct {
		Type  string         `json:"type"`
		Event ExecutionEvent `json:"event"`
	}
	if err := user.ReadJSON(&userLive); err != nil || userLive.Type != "event" || userLive.Event.Account != alice || userLive.Event.ObjectID != second.ID || userLive.Event.Sequence <= userSnapshot.Snapshot.Sequence {
		t.Fatalf("user live=%+v err=%v", userLive, err)
	}
	resp, err := http.Get(server.URL + "/v1/ws/user?token=query-token-forbidden")
	if err != nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("query token user stream err=%v status=%v", err, resp.StatusCode)
	}
	resp.Body.Close()
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

func TestBackupRestoreDrillPreservesCommittedExchangeState(t *testing.T) {
	s, chain, path := newTestService(t)
	seller := accountSession(t, s, alice, "restore-seller", "exchange:read", "exchange:trade")
	buyer := accountSession(t, s, bob, "restore-buyer", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, seller, "2020202020202020", 3*AmountScale)
	if _, err := s.CreditTestQuote(adminKey, bob, 10*AmountScale, "restore-credit"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, s, seller, "sell", 2*AmountScale, 2*AmountScale, "restore-sell"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, s, buyer, "buy", 2*AmountScale, AmountScale, "restore-buy"); err != nil {
		t.Fatal(err)
	}
	beforeSeller := s.Snapshot(alice)
	beforeBuyer := s.Snapshot(bob)
	backup, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	backupHash := sha256.Sum256(backup)
	if _, err := place(t, s, seller, "sell", 3*AmountScale, AmountScale, "post-backup-order"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, backup, 0o600); err != nil {
		t.Fatal(err)
	}
	restoredBytes, err := os.ReadFile(path)
	if err != nil || sha256.Sum256(restoredBytes) != backupHash {
		t.Fatalf("restored backup hash mismatch err=%v", err)
	}
	restored, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	afterSeller := restored.Snapshot(alice)
	afterBuyer := restored.Snapshot(bob)
	if digest(beforeSeller) != digest(afterSeller) || digest(beforeBuyer) != digest(afterBuyer) {
		t.Fatalf("restored snapshots differ\nbefore seller=%+v\nafter seller=%+v\nbefore buyer=%+v\nafter buyer=%+v", beforeSeller, afterSeller, beforeBuyer, afterBuyer)
	}
	if len(afterSeller.Orders) != 1 || afterSeller.Orders[0].Status != "partially_filled" || len(afterSeller.Trades) != 1 {
		t.Fatalf("restored execution state=%+v", afterSeller)
	}
	assertLedgerBalances(t, afterSeller)
	assertLedgerBalances(t, afterBuyer)
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
	req, err := http.NewRequest(http.MethodGet, server.URL+"/ready", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-Request-ID", "operator-check-0001")
	resp, err = http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 || resp.Header.Get("X-Request-ID") != "operator-check-0001" {
		t.Fatalf("ready err=%v status=%v requestID=%q", err, resp.StatusCode, resp.Header.Get("X-Request-ID"))
	}
	var readiness struct {
		Status         string `json:"status"`
		StateIntegrity bool   `json:"stateIntegrity"`
		DeployedPublic bool   `json:"deployedPublic"`
	}
	if json.NewDecoder(resp.Body).Decode(&readiness) != nil || readiness.Status != "ready_local_engine" || !readiness.StateIntegrity || readiness.DeployedPublic {
		t.Fatalf("readiness=%+v", readiness)
	}
	resp.Body.Close()
	resp, err = http.Get(server.URL + "/metrics")
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("metrics err=%v status=%v", err, resp.StatusCode)
	}
	metrics, err := io.ReadAll(resp.Body)
	if err != nil || !strings.Contains(string(metrics), "ynx_exchange_http_requests_total") || !strings.Contains(string(metrics), "ynx_exchange_http_duration_seconds_total") {
		t.Fatalf("metrics=%q err=%v", metrics, err)
	}
	resp.Body.Close()
	resp, err = http.Post(server.URL+"/v1/auth/challenges", "application/json", strings.NewReader(`{"account":"`+alice+`","deviceId":"web","scopes":["exchange:read"],"unknown":true}`))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 404 {
		t.Fatalf("legacy auth route must be absent, status=%d", resp.StatusCode)
	}
	resp.Body.Close()
	resp, err = http.Get(server.URL + "/v1/quant-adapter/capabilities")
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("quant capabilities err=%v status=%v", err, resp.StatusCode)
	}
	var capabilities struct {
		Version      string            `json:"version"`
		Capabilities []QuantCapability `json:"capabilities"`
		Source       QuantSource       `json:"source"`
	}
	if json.NewDecoder(resp.Body).Decode(&capabilities) != nil || capabilities.Version != QuantAdapterVersion || capabilities.Source.Status != "available" || len(capabilities.Capabilities) < 15 {
		t.Fatalf("quant capabilities=%+v", capabilities)
	}
	resp.Body.Close()
	req, err = http.NewRequest(http.MethodPost, server.URL+"/v1/quant-adapter/account", strings.NewReader(`{"mandate":{}}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-ID", "invalid request id with spaces")
	resp, err = http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 401 {
		t.Fatalf("quant adapter must fail closed without Gateway session: err=%v status=%v", err, resp.StatusCode)
	}
	var failure struct {
		Error     string `json:"error"`
		Code      string `json:"code"`
		RequestID string `json:"requestId"`
		ErrorID   string `json:"errorId"`
	}
	if json.NewDecoder(resp.Body).Decode(&failure) != nil || failure.Error != ErrUnauthorized.Error() || failure.Code != "unauthorized" || !validRequestID(failure.RequestID) || !strings.HasPrefix(failure.ErrorID, "error-") || resp.Header.Get("X-Request-ID") != failure.RequestID || resp.Header.Get("X-Error-ID") != failure.ErrorID {
		t.Fatalf("correlated failure=%+v requestHeader=%q errorHeader=%q", failure, resp.Header.Get("X-Request-ID"), resp.Header.Get("X-Error-ID"))
	}
	resp.Body.Close()
}

func TestHTTPPeerRateLimiterIsBoundedAndResets(t *testing.T) {
	s, _, _ := newTestService(t)
	server := NewServer(s)
	now := time.Date(2026, 7, 22, 20, 0, 0, 0, time.UTC)
	for i := 0; i < 300; i++ {
		if !server.allowPeer("192.0.2.1:12345", now) {
			t.Fatalf("request %d rejected early", i+1)
		}
	}
	if server.allowPeer("192.0.2.1:9999", now) {
		t.Fatal("same direct peer exceeded fixed window")
	}
	if !server.allowPeer("192.0.2.1:9999", now.Add(time.Minute)) {
		t.Fatal("peer window did not reset")
	}
	for i := 0; i < 10_100; i++ {
		server.allowPeer(fmt.Sprintf("198.51.%d.%d:1", (i/256)%256, i%256), now)
	}
	if len(server.rateByPeer) > 10_001 {
		t.Fatalf("rate limiter peer map unbounded: %d", len(server.rateByPeer))
	}
	server.rateByPeer = make(map[string]rateWindow, 10_000)
	for i := 0; i < 10_000; i++ {
		server.rateByPeer[fmt.Sprintf("stale-peer-%d", i)] = rateWindow{started: now, count: 1}
	}
	if !server.allowPeer("fresh-peer", now.Add(time.Minute)) {
		t.Fatal("new peer was rejected after stale windows expired")
	}
	if _, ok := server.rateByPeer["fresh-peer"]; !ok {
		t.Fatal("new peer was incorrectly collapsed into overflow after stale cleanup")
	}
	if _, ok := server.rateByPeer["__overflow__"]; ok {
		t.Fatal("overflow bucket remained after stale capacity was reclaimed")
	}
	server.rateByPeer["203.0.113.1"] = rateWindow{started: time.Now().UTC(), count: 300}
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.RemoteAddr = "203.0.113.1:4444"
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusTooManyRequests || recorder.Header().Get("Retry-After") != "60" || recorder.Header().Get("X-Error-ID") == "" {
		t.Fatalf("rate response status=%d headers=%v body=%s", recorder.Code, recorder.Header(), recorder.Body.String())
	}
	server.rateByPeer["203.0.113.2"] = rateWindow{started: time.Now().UTC()}
	for i := 0; i < cap(server.concurrency); i++ {
		server.concurrency <- struct{}{}
	}
	req = httptest.NewRequest(http.MethodGet, "/health", nil)
	req.RemoteAddr = "203.0.113.2:4444"
	recorder = httptest.NewRecorder()
	server.ServeHTTP(recorder, req)
	for i := 0; i < cap(server.concurrency); i++ {
		<-server.concurrency
	}
	if recorder.Code != http.StatusServiceUnavailable || recorder.Header().Get("Retry-After") != "1" || !strings.Contains(recorder.Body.String(), `"code":"capacity_exhausted"`) {
		t.Fatalf("capacity response status=%d headers=%v body=%s", recorder.Code, recorder.Header(), recorder.Body.String())
	}
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

func TestPublicMarketTapeContainsOnlyActualMatches(t *testing.T) {
	s, chain, _ := newTestService(t)
	a := accountSession(t, s, alice, "alice-tape", "exchange:read", "exchange:trade", "exchange:deposit")
	b := accountSession(t, s, bob, "bob-tape", "exchange:read", "exchange:trade", "exchange:deposit")
	confirmDeposit(t, s, chain, a, "aaaabbbbcccc0001", 2*AmountScale)
	confirmDeposit(t, s, chain, b, "aaaabbbbcccc0002", 2*AmountScale)
	_, _ = s.CreditTestQuote(adminKey, alice, 10*AmountScale, "tape-credit-a")
	_, _ = s.CreditTestQuote(adminKey, bob, 10*AmountScale, "tape-credit-b")
	if got := s.PublicTrades(100); len(got) != 0 {
		t.Fatalf("empty venue invented trades: %+v", got)
	}
	if _, e := place(t, s, a, "sell", AmountScale, AmountScale, "tape-sell"); e != nil {
		t.Fatal(e)
	}
	if _, e := place(t, s, b, "buy", AmountScale, AmountScale, "tape-buy"); e != nil {
		t.Fatal(e)
	}
	got := s.PublicTrades(100)
	if len(got) != 1 || got[0].Buyer != bob || got[0].Seller != alice || got[0].PriceMicro != AmountScale {
		t.Fatalf("tape=%+v", got)
	}
}

func FuzzOrderAuthorizationPayloadIsCanonicalAndBound(f *testing.F) {
	f.Add(int64(1_000_000), int64(2_000_000), "seed-idempotency", byte(0))
	f.Add(int64(9_223_372), int64(44), "unicode-订单", byte(1))
	f.Fuzz(func(t *testing.T, price, amount int64, idempotency string, sideBit byte) {
		if len(idempotency) > 256 {
			idempotency = idempotency[:256]
		}
		side := "buy"
		if sideBit%2 == 1 {
			side = "sell"
		}
		req := PlaceOrderRequest{Market: DefaultMarket, Side: side, Type: "limit", PriceMicro: price, AmountMicro: amount, IdempotencyKey: idempotency}
		first := OrderAuthorizationPayload(alice, req)
		second := OrderAuthorizationPayload(alice, req)
		if string(first) != string(second) || digest(first) != digest(second) {
			t.Fatal("canonical payload or digest is nondeterministic")
		}
		if amount != int64(^uint64(0)>>1) {
			changed := req
			changed.AmountMicro++
			if digest(first) == digest(OrderAuthorizationPayload(alice, changed)) {
				t.Fatal("amount mutation did not change authorization digest")
			}
		}
	})
}
