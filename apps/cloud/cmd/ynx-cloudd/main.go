package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
)

type devWalletVerifier struct{}

func (devWalletVerifier) Verify(_ context.Context, assertion cloud.WalletAssertion) error {
	if assertion.Signature != "dev-signed" || assertion.DevicePublicKey != "local-smoke-device" {
		return fmt.Errorf("development Wallet assertion rejected")
	}
	return nil
}

func main() {
	addr := flag.String("addr", ":8092", "listen address")
	data := flag.String("data", "tmp/cloud", "bounded local data directory")
	cloudUI := flag.String("cloud-ui", "apps/cloud/web", "Cloud static files")
	docsUI := flag.String("docs-ui", "apps/docs/web", "Docs static files")
	devWallet := flag.Bool("dev-wallet", false, "enable explicit local-only Wallet test verifier")
	flag.Parse()
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
		objects = cloud.RemoteObjectStore{BaseURL: u, Token: os.Getenv("YNX_OBJECT_STORE_TOKEN")}
	}
	service, err := cloud.New(cloud.Config{StatePath: filepath.Join(*data, "state.json"), ObjectDir: filepath.Join(*data, "objects"), WalletVerifier: verifier, AIProvider: ai, TrustSink: trust, ObjectStore: objects})
	if err != nil {
		log.Fatal(err)
	}
	api := cloud.NewServer(service).Handler()
	mux := http.NewServeMux()
	mux.Handle("/api/", api)
	mux.Handle("/health", api)
	mux.Handle("/cloud/", http.StripPrefix("/cloud/", http.FileServer(http.Dir(*cloudUI))))
	mux.Handle("/docs/", http.StripPrefix("/docs/", http.FileServer(http.Dir(*docsUI))))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/cloud/", http.StatusTemporaryRedirect)
	})
	server := &http.Server{Addr: *addr, Handler: cloud.SecureHandler(mux), ReadHeaderTimeout: 5e9, ReadTimeout: 15e9, WriteTimeout: 30e9, IdleTimeout: 60e9}
	log.Printf("ynx-cloudd listening on %s; durability is bounded local persistence, not production storage", *addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
