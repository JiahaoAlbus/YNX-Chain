package main

import (
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/commerce"
)

type seedResult struct {
	StoreID    string   `json:"storeId"`
	ProductIDs []string `json:"productIds"`
	Published  int      `json:"published"`
}

func main() {
	state := flag.String("state", "tmp/shop/state.json", "persistent Shop state path")
	assetBase := flag.String("asset-base", "https://shop.ynxweb4.com", "public HTTPS origin that serves Shop assets")
	actor := flag.String("actor", "ynx-testnet-demo-curator", "audited actor recorded for the demo catalog")
	confirm := flag.Bool("confirm-testnet-demo", false, "confirm creation of clearly labelled public testnet demo inventory")
	flag.Parse()

	if !*confirm {
		log.Fatal("-confirm-testnet-demo is required")
	}
	base := strings.TrimRight(strings.TrimSpace(*assetBase), "/")
	if !strings.HasPrefix(base, "https://") {
		log.Fatal("-asset-base must use HTTPS")
	}

	keyHex := strings.TrimSpace(os.Getenv("YNX_SHOP_STATE_HMAC_KEY"))
	key, err := hex.DecodeString(keyHex)
	if err != nil || len(key) < 32 {
		log.Fatal("YNX_SHOP_STATE_HMAC_KEY must be at least 64 hexadecimal characters")
	}
	store, err := commerce.OpenWithIntegrity(*state, key)
	if err != nil {
		log.Fatal(err)
	}

	profile, err := store.CreateStore(*actor, commerce.CreateStoreInput{
		Name:           "YNX Testnet Demo Store",
		Description:    "Official public-testnet demonstration catalog for exercising YNX Shop discovery, cart, inventory reservation, YNX Pay handoff, order history, refunds, disputes, and Trust evidence. Items are test fixtures and are not shipped.",
		Policy:         "TESTNET ONLY. No physical goods, fiat value, delivery promise, warranty, or production purchase is created. YNXT is testnet currency. Inventory, orders, payment handoffs, refunds, reviews, and disputes exist solely for product and load testing.",
		TrustURL:       "https://trust.ynxweb4.com",
		IdempotencyKey: "demo-store-v1",
	})
	if err != nil {
		log.Fatal(err)
	}
	if _, err = store.ActivateStore(*actor, profile.ID); err != nil {
		log.Fatal(err)
	}

	products := []commerce.CreateProductInput{
		{
			StoreID: profile.ID, Title: "Developer Console Kit — Testnet Demo", Category: "tech",
			Description:    "A clearly labelled demo listing used to test search, variants, cart totals, reservations, payment handoff and order evidence. No physical item is shipped.",
			Media:          []commerce.MediaAsset{{URL: base + "/assets/catalog/developer-console-kit.png", AltText: "Navy portable developer console, secure module, cable and carry case", Kind: "image"}},
			Variants:       []commerce.Variant{{ID: "variant_demo_console_v1", Name: "Console kit", SKU: "DEMO-CONSOLE-KIT", PriceYNXT: 72, Inventory: 250}},
			IdempotencyKey: "demo-product-console-v1",
		},
		{
			StoreID: profile.ID, Title: "Solar Power Kit — Testnet Demo", Category: "outdoor",
			Description:    "A demo outdoor listing for testing marketplace filters, stock visibility and multi-item YNXT checkout. It represents no claim of physical fulfillment.",
			Media:          []commerce.MediaAsset{{URL: base + "/assets/catalog/solar-power-kit.png", AltText: "Foldable solar panel, rugged power bank, cable and navy pouch", Kind: "image"}},
			Variants:       []commerce.Variant{{ID: "variant_demo_solar_v1", Name: "Field kit", SKU: "DEMO-SOLAR-FIELD", PriceYNXT: 48, Inventory: 250}},
			IdempotencyKey: "demo-product-solar-v1",
		},
		{
			StoreID: profile.ID, Title: "Modular Desk Light — Testnet Demo", Category: "home",
			Description:    "A demo home listing for exercising product detail, quantity, profile, privacy and order-history flows. It is not a production retail offer.",
			Media:          []commerce.MediaAsset{{URL: base + "/assets/catalog/modular-desk-light.png", AltText: "Cobalt modular desk light with charging base and braided cable", Kind: "image"}},
			Variants:       []commerce.Variant{{ID: "variant_demo_light_v1", Name: "Desk set", SKU: "DEMO-DESK-LIGHT", PriceYNXT: 24, Inventory: 250}},
			IdempotencyKey: "demo-product-light-v1",
		},
	}

	result := seedResult{StoreID: profile.ID, ProductIDs: make([]string, 0, len(products))}
	for _, input := range products {
		product, createErr := store.CreateProduct(*actor, input)
		if createErr != nil {
			log.Fatal(createErr)
		}
		product, publishErr := store.PublishProduct(*actor, product.ID)
		if publishErr != nil {
			log.Fatal(publishErr)
		}
		if !product.Published {
			log.Fatal("product publication did not persist")
		}
		result.ProductIDs = append(result.ProductIDs, product.ID)
		result.Published++
	}

	encoded, err := json.Marshal(result)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(string(encoded))
}
