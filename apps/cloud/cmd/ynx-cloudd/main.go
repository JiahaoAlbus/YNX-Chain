package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
)

type devWalletVerifier struct{}

func canonicalChallenge(challenge cloud.GatewayChallenge) ([]byte, error) {
	values := []any{challenge.Account, challenge.BundleID, challenge.Challenge, challenge.ExpiresAt, challenge.IssuedAt, challenge.ProductClientID, challenge.ProductDeviceAlgorithm, challenge.ProductDeviceKey, challenge.RequestDigest, challenge.Scopes, challenge.Version}
	keys := []string{"account", "bundleId", "challenge", "expiresAt", "issuedAt", "productClientId", "productDeviceAlgorithm", "productDeviceKey", "requestDigest", "scopes", "version"}
	result := []byte{'{'}
	for i, key := range keys {
		if i > 0 {
			result = append(result, ',')
		}
		encodedKey, _ := json.Marshal(key)
		encodedValue, err := json.Marshal(values[i])
		if err != nil {
			return nil, err
		}
		result = append(result, encodedKey...)
		result = append(result, ':')
		result = append(result, encodedValue...)
	}
	return append(result, '}'), nil
}

func verifyDevelopmentDeviceSignature(envelope cloud.WalletSessionEnvelope) bool {
	keyBytes, err := base64.RawURLEncoding.DecodeString(envelope.AuthorizationRequest.ProductDeviceKey)
	if err != nil {
		return false
	}
	x, y := elliptic.UnmarshalCompressed(elliptic.P256(), keyBytes)
	if x == nil {
		return false
	}
	canonical, err := canonicalChallenge(envelope.GatewayCompletion.Challenge)
	if err != nil {
		return false
	}
	digest := sha256.Sum256(append([]byte("YNX_PRODUCT_SESSION_CHALLENGE_V1\n"), canonical...))
	signature, err := base64.RawURLEncoding.DecodeString(envelope.GatewayCompletion.DeviceSignature)
	return err == nil && ecdsa.VerifyASN1(&ecdsa.PublicKey{Curve: elliptic.P256(), X: x, Y: y}, digest[:], signature)
}

func (devWalletVerifier) Verify(_ context.Context, envelope cloud.WalletSessionEnvelope) (cloud.CentralSessionClaims, error) {
	a := envelope.WalletApproval
	legacySmokeSignature := envelope.GatewayCompletion.DeviceSignature == strings.Repeat("A", 96)
	if a.WalletSignature != strings.Repeat("0", 128) || (!legacySmokeSignature && !verifyDevelopmentDeviceSignature(envelope)) {
		return cloud.CentralSessionClaims{}, fmt.Errorf("development canonical Wallet envelope rejected")
	}
	return cloud.CentralSessionClaims{VerifierVersion: "wallet-auth-v1", SessionBinding: strings.Repeat("b", 64), ProductClientID: a.ProductClientID, BundleID: a.BundleID, ProductDeviceAlgorithm: a.ProductDeviceAlgorithm, RequestDigest: a.RequestDigest, Account: a.Account, Scopes: a.GrantedScopes, IssuedAt: a.IssuedAt, ExpiresAt: a.ExpiresAt}, nil
}

func main() {
	addr := flag.String("addr", ":8092", "listen address")
	data := flag.String("data", "tmp/cloud", "bounded local data directory")
	cloudUI := flag.String("cloud-ui", "apps/cloud/web", "Cloud static files")
	docsUI := flag.String("docs-ui", "apps/docs/web", "Docs static files")
	devWallet := flag.Bool("dev-wallet", false, "enable explicit local-only Wallet test verifier")
	backupDir := flag.String("backup", "", "create a verified recovery backup in this new directory and exit")
	restoreDir := flag.String("restore", "", "restore this verified recovery backup into the new data directory and exit")
	rollbackV1 := flag.String("rollback-state-v1", "", "write a verified schema-v1 rollback state to this new file and exit")
	maxConcurrent := flag.Int("max-concurrent", 128, "maximum in-flight HTTP requests before fail-fast backpressure")
	requestsPerMinute := flag.Int("requests-per-minute", 120, "fixed-window requests per direct TCP client")
	lifecycleWorkerInterval := flag.Duration("lifecycle-worker-interval", 2*time.Second, "interval for recovering persisted pending storage lifecycle transitions")
	lifecycleWorkerBatch := flag.Int("lifecycle-worker-batch", 8, "maximum pending storage lifecycle transitions claimed per worker cycle")
	exitMode := flag.Bool("user-exit-mode", false, "disable new writes while preserving authentication, read, export, revoke, cancel, trash and delete paths")
	flag.Parse()
	if *lifecycleWorkerInterval < 100*time.Millisecond || *lifecycleWorkerInterval > time.Minute {
		log.Fatal("-lifecycle-worker-interval must be between 100ms and 1m")
	}
	if *lifecycleWorkerBatch < 1 || *lifecycleWorkerBatch > 64 {
		log.Fatal("-lifecycle-worker-batch must be between 1 and 64")
	}
	operations := 0
	for _, value := range []string{*backupDir, *restoreDir, *rollbackV1} {
		if value != "" {
			operations++
		}
	}
	if operations > 1 {
		log.Fatal("-backup, -restore and -rollback-state-v1 are mutually exclusive")
	}
	if *backupDir != "" {
		manifest, err := cloud.CreateRecoveryBackup(*data, *backupDir, "operator-backup-of-configured-object-store", time.Now())
		if err != nil {
			log.Fatal(err)
		}
		log.Printf("recovery backup verified: %d files at %s", len(manifest.Files), *backupDir)
		return
	}
	if *restoreDir != "" {
		manifest, err := cloud.RestoreRecoveryBackup(*restoreDir, *data)
		if err != nil {
			log.Fatal(err)
		}
		log.Printf("recovery restore verified: %d files into %s", len(manifest.Files), *data)
		return
	}
	if *rollbackV1 != "" {
		if err := cloud.RollbackStateToV1(filepath.Join(*data, "state.json"), *rollbackV1); err != nil {
			log.Fatal(err)
		}
		log.Printf("schema-v1 rollback state written to %s; current state was not modified", *rollbackV1)
		return
	}
	verifier := cloud.WalletVerifier(cloud.UnavailableWalletVerifier{})
	if u := os.Getenv("YNX_WALLET_VERIFY_URL"); u != "" {
		verifier = cloud.RemoteWalletVerifier{BaseURL: u, Token: os.Getenv("YNX_WALLET_VERIFY_TOKEN")}
	}
	if *devWallet {
		if !strings.HasPrefix(*addr, "127.0.0.1:") && !strings.HasPrefix(*addr, "localhost:") {
			log.Fatal("-dev-wallet requires a loopback listen address")
		}
		verifier = devWalletVerifier{}
	}
	ai := cloud.AIProvider(cloud.UnavailableAIProvider{})
	if u := os.Getenv("YNX_AI_GATEWAY_URL"); u != "" {
		ai = cloud.RemoteAIProvider{BaseURL: u, Token: os.Getenv("YNX_AI_GATEWAY_TOKEN"), Model: os.Getenv("YNX_AI_MODEL")}
	}
	trust := cloud.TrustSink(cloud.LocalAuditTrustSink{})
	if u := os.Getenv("YNX_TRUST_URL"); u != "" {
		trust = cloud.RemoteTrustSink{BaseURL: u, Token: os.Getenv("YNX_TRUST_TOKEN")}
	}
	var objects cloud.ObjectStore = cloud.LocalObjectStore{Root: filepath.Join(*data, "objects")}
	if u := os.Getenv("YNX_OBJECT_STORE_URL"); u != "" {
		objects = cloud.RemoteObjectStore{BaseURL: u, Token: os.Getenv("YNX_OBJECT_STORE_TOKEN"), DirectUploadOrigin: os.Getenv("YNX_DIRECT_UPLOAD_ORIGIN")}
	}
	service, err := cloud.New(cloud.Config{StatePath: filepath.Join(*data, "state.json"), ObjectDir: filepath.Join(*data, "objects"), WalletVerifier: verifier, AIProvider: ai, TrustSink: trust, ObjectStore: objects, ReleaseCommit: os.Getenv("YNX_RELEASE_COMMIT"), ReleaseVersion: os.Getenv("YNX_RELEASE_VERSION"), ExitMode: *exitMode})
	if err != nil {
		log.Fatal(err)
	}
	workerCtx, stopWorker := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopWorker()
	go func() {
		run := func() {
			result, err := service.RecoverPendingStorageTransitions(workerCtx, *lifecycleWorkerBatch)
			if err != nil {
				if workerCtx.Err() == nil {
					log.Printf("storage lifecycle recovery worker failed: %v", err)
				}
				return
			}
			if result.Claimed > 0 {
				log.Printf("storage lifecycle recovery worker claimed=%d completed=%d failed=%d", result.Claimed, result.Completed, result.Failed)
			}
		}
		run()
		ticker := time.NewTicker(*lifecycleWorkerInterval)
		defer ticker.Stop()
		for {
			select {
			case <-workerCtx.Done():
				return
			case <-ticker.C:
				run()
			}
		}
	}()
	api := cloud.NewServerWithLimits(service, cloud.ServerLimits{MaxConcurrent: *maxConcurrent, RequestsPerMinute: *requestsPerMinute}).Handler()
	mux := http.NewServeMux()
	mux.Handle("/api/", api)
	mux.Handle("/health", api)
	mux.Handle("/health/", api)
	mux.Handle("/cloud/", http.StripPrefix("/cloud/", http.FileServer(http.Dir(*cloudUI))))
	mux.Handle("/docs/", http.StripPrefix("/docs/", http.FileServer(http.Dir(*docsUI))))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/cloud/", http.StatusTemporaryRedirect)
	})
	server := &http.Server{Addr: *addr, Handler: cloud.SecureHandlerWithDirectUploadOrigin(mux, os.Getenv("YNX_DIRECT_UPLOAD_ORIGIN")), ReadHeaderTimeout: 5e9, ReadTimeout: 15e9, WriteTimeout: 30e9, IdleTimeout: 60e9}
	serverErrors := make(chan error, 1)
	go func() {
		serverErrors <- server.ListenAndServe()
	}()
	log.Printf("ynx-cloudd listening on %s; durability is bounded local persistence, not production storage", *addr)
	select {
	case err := <-serverErrors:
		if err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	case <-workerCtx.Done():
		shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelShutdown()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("ynx-cloudd graceful shutdown failed: %v", err)
			_ = server.Close()
		}
		if err := <-serverErrors; err != nil && err != http.ErrServerClosed {
			log.Printf("ynx-cloudd stopped with server error: %v", err)
		}
	}
}
