package main

import (
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
	flag.Parse()
	store, err := commerce.Open(*state)
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
