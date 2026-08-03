package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/exchangeproduct"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"
)

type fixtureChain struct {
	transfers map[string]exchangeproduct.ChainTransfer
}

func (f fixtureChain) Transfer(hash string) (exchangeproduct.ChainTransfer, error) {
	transfer, ok := f.transfers[hash]
	if !ok {
		return exchangeproduct.ChainTransfer{}, exchangeproduct.ErrNotFound
	}
	return transfer, nil
}

type fixtureAccount struct {
	address string
	key     *secp256k1.PrivateKey
	session exchangeproduct.WalletSession
}

func main() {
	if os.Getenv("YNX_EXCHANGE_SEED_CONFIRM") != "public-testnet-only" {
		log.Fatal("set YNX_EXCHANGE_SEED_CONFIRM=public-testnet-only; this command must never target production funds")
	}
	statePath := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_STATE_PATH"))
	adminKey := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_ADMIN_API_KEY"))
	if statePath == "" || len(adminKey) < 16 {
		log.Fatal("YNX_EXCHANGE_STATE_PATH and an admin API key of at least 16 characters are required")
	}
	seller := deterministicAccount(91)
	buyer := deterministicAccount(92)
	depositHash := strings.Repeat("a", 63) + "1"
	chain := fixtureChain{transfers: map[string]exchangeproduct.ChainTransfer{
		depositHash: {Hash: depositHash, From: seller.address, To: buyer.address, AmountMicro: 20 * exchangeproduct.AmountScale, Confirmations: 100, Committed: true},
	}}
	service, err := exchangeproduct.New(exchangeproduct.Config{
		StatePath: statePath, APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback",
		CustodyAddress: buyer.address, IndexerURL: "fixture://public-testnet-seed",
		RequiredConfirmations: 12, MakerFeeBPS: 10, TakerFeeBPS: 20,
		WithdrawalFeeMicroYNXT: 10_000, MaxOrderNotionalMicro: 100_000 * exchangeproduct.AmountScale,
		MaxWithdrawalMicro: 25_000 * exchangeproduct.AmountScale, Chain: chain,
	})
	if err != nil {
		log.Fatal(err)
	}
	seller.session = openSession(service, seller, "public-seed-seller")
	buyer.session = openSession(service, buyer, "public-seed-buyer")
	intent, err := service.CreateDepositIntent(seller.session, "public-seed-deposit-intent")
	if err != nil {
		log.Fatal(err)
	}
	if _, err = service.ObserveDeposit(seller.session, intent.ID, depositHash, "public-seed-deposit-observe"); err != nil {
		log.Fatal(err)
	}
	if _, err = service.CreditTestQuote(adminKey, buyer.address, 30*exchangeproduct.AmountScale, "public-seed-quote-credit"); err != nil {
		log.Fatal(err)
	}
	for index := 0; index < 30; index++ {
		price := exchangeproduct.AmountScale + int64((index%7)-3)*2_500
		amount := int64(250_000)
		if _, err = place(service, seller, "sell", price, amount, fmt.Sprintf("public-seed-sell-%02d", index)); err != nil {
			log.Fatal(err)
		}
		if _, err = place(service, buyer, "buy", price, amount, fmt.Sprintf("public-seed-buy-%02d", index)); err != nil {
			log.Fatal(err)
		}
	}
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
		"market": exchangeproduct.DefaultMarket, "matchedTrades": len(service.PublicTrades(100)),
		"source": "YNX-owned matching engine; deterministic public Testnet fixture accounts",
		"seller": seller.address, "buyer": buyer.address,
	})
}

func deterministicAccount(seed byte) fixtureAccount {
	secret := make([]byte, 32)
	secret[31] = seed
	key := secp256k1.PrivKeyFromBytes(secret)
	hasher := sha3.NewLegacyKeccak256()
	_, _ = hasher.Write(key.PubKey().SerializeUncompressed()[1:])
	sum := hasher.Sum(nil)
	evmAddress, err := accountaddress.FromBytes(sum[len(sum)-accountaddress.PayloadLength:])
	if err != nil {
		panic(err)
	}
	address, err := accountaddress.Encode(evmAddress)
	if err != nil {
		panic(err)
	}
	return fixtureAccount{address: address, key: key}
}

func openSession(service *exchangeproduct.Service, account fixtureAccount, device string) exchangeproduct.WalletSession {
	challenge, err := service.CreateChallenge(account.address, device, []string{"exchange:read", "exchange:trade", "exchange:deposit"})
	if err != nil {
		log.Fatal(err)
	}
	publicKey := hex.EncodeToString(account.key.PubKey().SerializeCompressed())
	session, _, err := service.CompleteSession(exchangeproduct.CompleteSessionRequest{
		ChallengeID: challenge.ID, WalletPublicKey: publicKey,
		WalletSignature: sign(account.key, exchangeproduct.WalletChallengePayload(challenge)),
	})
	if err != nil {
		log.Fatal(err)
	}
	return session
}

func place(service *exchangeproduct.Service, account fixtureAccount, side string, price, amount int64, key string) (exchangeproduct.Order, error) {
	request := exchangeproduct.PlaceOrderRequest{Market: exchangeproduct.DefaultMarket, Side: side, Type: "limit", PriceMicro: price, AmountMicro: amount, IdempotencyKey: key}
	request.WalletSignature = sign(account.key, exchangeproduct.OrderAuthorizationPayload(account.session.Account, request))
	return service.PlaceOrder(account.session, request)
}

func sign(key *secp256k1.PrivateKey, payload []byte) string {
	hash := sha256.Sum256(payload)
	signature := ecdsa.Sign(key, hash[:])
	rScalar, sScalar := signature.R(), signature.S()
	r, s := rScalar.Bytes(), sScalar.Bytes()
	return hex.EncodeToString(append(r[:], s[:]...))
}
