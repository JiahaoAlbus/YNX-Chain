package main

import (
	"context"
	"encoding/hex"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/commerce"
	"github.com/JiahaoAlbus/YNX-Chain/internal/commerceentry"
)

func main() {
	addr := flag.String("http", "127.0.0.1:8095", "HTTP listen address")
	nativeAPI := flag.Bool("native-api", false, "serve the independent client's fixed shop-api origin without Web assets")
	notificationFile := flag.String("native-pay-notification-receivers", "", "explicit private original Pay merchant notification credential file; Native API only, no funds authority")
	state := flag.String("state", "tmp/shop/state.json", "persistent state path")
	buyer := flag.String("buyer-assets", "apps/shop/dist", "buyer web assets")
	seller := flag.String("seller-assets", "apps/seller-console/dist", "seller web assets")
	merchant := flag.String("merchant-assets", "apps/merchant-console/dist", "source-bound built merchant public assets")
	restoreBackup := flag.Bool("restore-backup", false, "restore the last verified state backup before starting")
	exportRollback := flag.String("export-rollback", "", "write a new bounded rollback snapshot and exit; never overwrites an existing file")
	rollbackVersion := flag.Int("rollback-version", 5, "rollback snapshot target version: 3, 4, 5, 6 or 7; refused when retired intent protection cannot be represented")
	pruneTransientBefore := flag.String("prune-transient-before", "", "preview or prune terminal AI jobs and rate-limit samples older than this RFC3339 cutoff, then exit")
	confirmPruneTransient := flag.Bool("confirm-prune-transient", false, "apply the transient retention preview; requires --prune-transient-before and an integrity key")
	flag.Parse()
	if *notificationFile != "" && !*nativeAPI {
		log.Fatal("Native notification receiver requires --native-api")
	}
	notificationReceivers, notificationErr := loadOriginalNativePayNotificationReceivers(*notificationFile)
	if notificationErr != nil {
		log.Fatal(notificationErr)
	}
	runtime, runtimeErr := prepareOriginalShopRuntime(context.Background(), originalShopFiles{os.Getenv("YNX_SHOP_BACKEND_KEY_ID"), os.Getenv("YNX_SHOP_BACKEND_KEY_FILE"), os.Getenv("YNX_SHOP_BROWSER_SEAL_FILE")})
	if runtimeErr != nil {
		log.Fatal(runtimeErr)
	}
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
	if *exportRollback != "" && *pruneTransientBefore != "" {
		log.Fatal("--export-rollback and --prune-transient-before are mutually exclusive")
	}
	if *confirmPruneTransient && *pruneTransientBefore == "" {
		log.Fatal("--confirm-prune-transient requires --prune-transient-before")
	}
	if *exportRollback != "" {
		if err := store.ExportRollbackSnapshot(*exportRollback, *rollbackVersion); err != nil {
			log.Fatal(err)
		}
		log.Printf("exported Snapshot v%d rollback file to %s", *rollbackVersion, *exportRollback)
		return
	}
	if *pruneTransientBefore != "" {
		if len(integrityKey) == 0 {
			log.Fatal("transient retention pruning requires YNX_SHOP_STATE_HMAC_KEY")
		}
		cutoff, parseErr := time.Parse(time.RFC3339, *pruneTransientBefore)
		if parseErr != nil {
			log.Fatal("--prune-transient-before must be RFC3339")
		}
		preview, previewErr := store.PreviewTransientDataPrune(cutoff.UTC())
		if previewErr != nil {
			log.Fatal(previewErr)
		}
		log.Printf("transient retention preview cutoff=%s ai_jobs=%d request_samples=%d protected_classes=%v", preview.Cutoff.Format(time.RFC3339), preview.AIJobs, preview.RequestSamples, preview.ProtectedClasses)
		if !*confirmPruneTransient {
			log.Print("preview only; rerun with --confirm-prune-transient to apply")
			return
		}
		result, pruneErr := store.PruneTransientData(cutoff.UTC())
		if pruneErr != nil {
			log.Fatal(pruneErr)
		}
		log.Printf("pruned transient data cutoff=%s ai_jobs=%d request_samples=%d completed_at=%s", result.Cutoff.Format(time.RFC3339), result.AIJobs, result.RequestSamples, result.CompletedAt.Format(time.RFC3339))
		return
	}
	if err := store.Recover(); err != nil {
		log.Fatal(err)
	}
	cfg := commerce.ServerConfig{Auth: commerce.HTTPAuthGateway{BaseURL: os.Getenv("YNX_SHOP_GATEWAY_URL"), ServiceKey: os.Getenv("YNX_SHOP_GATEWAY_KEY")}, Pay: commerce.HTTPPayVerifier{BaseURL: os.Getenv("YNX_SHOP_PAY_URL"), APIKey: os.Getenv("YNX_SHOP_PAY_KEY"), MerchantID: os.Getenv("YNX_SHOP_PAY_MERCHANT_ID"), PayoutAddress: os.Getenv("YNX_SHOP_PAY_PAYOUT_ADDRESS")}, Trust: commerce.HTTPTrustGateway{BaseURL: os.Getenv("YNX_SHOP_TRUST_URL"), APIKey: os.Getenv("YNX_SHOP_TRUST_KEY"), PublicBaseURL: os.Getenv("YNX_SHOP_TRUST_PUBLIC_URL")}, AI: commerce.HTTPAIGateway{BaseURL: os.Getenv("YNX_SHOP_AI_URL"), APIKey: os.Getenv("YNX_SHOP_AI_KEY")}, BuyerAssets: http.Dir(*buyer), SellerAssets: http.Dir(*seller)}
	// The original engine remains the sole public catalog/store. Static pages and
	// legacy gateway configuration cannot silently become private authority.
	// Actual role factories need independent protected profile/actor inputs.
	cfg.NativeInvoiceOnly = *nativeAPI
	cfg.NativePayNotificationReceivers = notificationReceivers
	documents := commerce.NewServer(store, cfg)
	engine := documents.Handler()
	buyerPrivate, sellerPrivate, identity, buyerDocuments, sellerDocuments, privateErr := runtime.servers(context.Background(), store, cfg)
	if privateErr != nil {
		log.Fatal(privateErr)
	}
	// Dedicated Source read plane borrows this SAME Store. Its normal factory
	// owns qualified Auth/SDK/LINK registration; no flags/ENV enroll a Source.
	invoiceRead, invoiceReadErr := commerce.OpenOriginalShopInvoiceReadService(context.Background(), func() (*commerce.Store, error) { return store, nil })
	log.Printf("Shop Seller readiness: seller_http=%s v4_listener=%s wallet_v4_borrow=request_verification_required shopd_expected_process=external_registration",
		sellerHTTPReadiness(sellerPrivate), shopV4ListenerReadiness(invoiceReadErr))
	closeInvoiceRead := func() error {
		if invoiceRead == nil {
			return nil
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return invoiceRead.Close(ctx)
	}
	if invoiceReadErr != nil {
		if invoiceRead != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			closeErr := invoiceRead.Close(ctx)
			cancel()
			invoiceReadErr = errors.Join(invoiceReadErr, closeErr)
		}
		log.Printf("original invoice Source read unavailable: %v", invoiceReadErr)
	} else {
		defer func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := invoiceRead.Close(ctx); err != nil {
				log.Printf("original invoice Source read close: %v", err)
			}
		}()
		go func() {
			if err := invoiceRead.Serve(); err != nil {
				log.Print("Shop Seller readiness: v4_listener=stopped")
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				closeErr := invoiceRead.Close(ctx)
				log.Printf("original invoice Source read stopped: %v", errors.Join(err, closeErr))
			}
		}()
	}
	if buyerDocuments == nil {
		buyerDocuments = documents
	}
	var mounted http.Handler
	var mountErr error
	if *nativeAPI {
		mounted = composeOriginalNativeShopAPI(engine, buyerPrivate, sellerPrivate)
	} else {
		mounted, mountErr = composeOriginalCommerceWeb(*buyer, *seller, *merchant, engine, buyerPrivate, sellerPrivate, nil, identity, buyerDocuments, sellerDocuments)
	}
	if mountErr != nil {
		log.Fatal(errors.Join(mountErr, closeInvoiceRead()))
	}
	srv := &http.Server{Addr: *addr, Handler: mounted, ReadHeaderTimeout: 5 * time.Second}
	log.Printf("ynx-shopd listening on %s", *addr)
	serveErr := srv.ListenAndServe()
	log.Fatal(errors.Join(serveErr, closeInvoiceRead()))
}

func sellerHTTPReadiness(seller http.Handler) string {
	if seller == nil {
		return "original_authority_not_supplied"
	}
	return "handler_configured"
}

func shopV4ListenerReadiness(err error) string {
	switch {
	case err == nil:
		return "bound"
	case errors.Is(err, commerce.ErrShopInvoiceReadAuthReleaseNotSupplied):
		return "auth_release_not_supplied"
	case errors.Is(err, commerce.ErrShopInvoiceReadAuthBootstrap):
		return "auth_bootstrap_failed"
	case errors.Is(err, commerce.ErrShopInvoiceReadListenerIdentity):
		return "listener_identity_unavailable"
	default:
		return "source_unavailable"
	}
}

// Each complete original canonical handler is fixed at composition, never chosen
// from request JSON. Public paths alone cannot activate any private capability.
func composeOriginalCommerceWeb(buyerAssets, sellerAssets, merchantAssets string, publicShop, buyer, seller, merchant, shopIdentity http.Handler, buyerDocuments, sellerDocuments *commerce.Server) (http.Handler, error) {
	return commerceentry.New(commerceentry.Inputs{BuyerDocuments: buyerDocuments, SellerDocuments: sellerDocuments, BuyerAssets: os.DirFS(buyerAssets), SellerAssets: os.DirFS(sellerAssets), MerchantAssets: os.DirFS(merchantAssets), PublicShop: publicShop, Buyer: buyer, Seller: seller, Merchant: merchant, ShopIdentity: shopIdentity})
}
