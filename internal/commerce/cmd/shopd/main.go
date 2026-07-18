package main

import (
	"encoding/hex"
	"flag"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/commerce"
)

func main() {
	addr := flag.String("http", "127.0.0.1:8095", "HTTP listen address")
	state := flag.String("state", "tmp/shop/state.json", "persistent state path")
	buyer := flag.String("buyer-assets", "apps/shop", "buyer web assets")
	seller := flag.String("seller-assets", "apps/seller-console", "seller web assets")
	restoreBackup := flag.Bool("restore-backup", false, "restore the last verified state backup before starting")
	flag.Parse()
	var integrityKey []byte
	if value := os.Getenv("YNX_SHOP_STATE_HMAC_KEY"); value != "" {
		var err error
		integrityKey, err = hex.DecodeString(value)
		if err != nil || len(integrityKey) < 32 {
			log.Fatal("YNX_SHOP_STATE_HMAC_KEY must be at least 64 hexadecimal characters")
		}
	}
	if *restoreBackup {
		if len(integrityKey) == 0 {
			log.Fatal("backup restoration requires YNX_SHOP_STATE_HMAC_KEY")
		}
		if err := commerce.RestoreCommerceBackup(*state, integrityKey); err != nil {
			log.Fatal(err)
		}
	}
	var store *commerce.Store
	var err error
	if len(integrityKey) > 0 {
		store, err = commerce.OpenWithIntegrity(*state, integrityKey)
	} else {
		store, err = commerce.Open(*state)
		log.Print("warning: YNX_SHOP_STATE_HMAC_KEY is unset; local unsigned state mode only")
	}
	if err != nil {
		log.Fatal(err)
	}
	if err := store.Recover(); err != nil {
		log.Fatal(err)
	}
	cfg := commerce.ServerConfig{Auth: commerce.HTTPAuthGateway{BaseURL: os.Getenv("YNX_SHOP_GATEWAY_URL"), ServiceKey: os.Getenv("YNX_SHOP_GATEWAY_KEY")}, Pay: commerce.HTTPPayVerifier{BaseURL: os.Getenv("YNX_SHOP_PAY_URL"), APIKey: os.Getenv("YNX_SHOP_PAY_KEY"), MerchantID: os.Getenv("YNX_SHOP_PAY_MERCHANT_ID"), PayoutAddress: os.Getenv("YNX_SHOP_PAY_PAYOUT_ADDRESS")}, Trust: commerce.HTTPTrustGateway{BaseURL: os.Getenv("YNX_SHOP_TRUST_URL"), APIKey: os.Getenv("YNX_SHOP_TRUST_KEY"), PublicBaseURL: os.Getenv("YNX_SHOP_TRUST_PUBLIC_URL")}, AI: commerce.HTTPAIGateway{BaseURL: os.Getenv("YNX_SHOP_AI_URL"), APIKey: os.Getenv("YNX_SHOP_AI_KEY")}, BuyerAssets: http.Dir(*buyer), SellerAssets: http.Dir(*seller)}
	srv := &http.Server{Addr: *addr, Handler: commerce.NewServer(store, cfg).Handler(), ReadHeaderTimeout: 5 * time.Second}
	log.Printf("ynx-shopd listening on %s", *addr)
	log.Fatal(srv.ListenAndServe())
}
