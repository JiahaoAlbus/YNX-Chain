package main

import (
	"context"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chat"
	"github.com/JiahaoAlbus/YNX-Chain/internal/mutationfreeze"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"github.com/JiahaoAlbus/YNX-Chain/internal/social"
	"github.com/JiahaoAlbus/YNX-Chain/internal/square"
)

func main() {
	httpAddr := flag.String("http", envOrDefault("YNX_SOCIAL_HTTP_ADDR", "127.0.0.1:6491"), "Social HTTP listen address")
	stateDir := flag.String("state-dir", envOrDefault("YNX_SOCIAL_STATE_DIR", "tmp/social"), "Social persistent state directory")
	checkConfig := flag.Bool("check-config", false, "validate configuration without starting the service")
	flag.Parse()

	tokenKey, err := decodeKey("YNX_SOCIAL_TOKEN_KEY")
	if err != nil {
		log.Fatal(err)
	}
	rateMax, err := envInt("YNX_SOCIAL_RATE_LIMIT_MAX", 300)
	if err != nil {
		log.Fatal(err)
	}
	rateWindow, err := time.ParseDuration(envOrDefault("YNX_SOCIAL_RATE_LIMIT_WINDOW", "1m"))
	if err != nil || rateWindow <= 0 {
		log.Fatal("YNX_SOCIAL_RATE_LIMIT_WINDOW must be a positive Go duration")
	}
	serviceKey := strings.TrimSpace(os.Getenv("YNX_SOCIAL_INTERNAL_API_KEY"))
	cloudAuthorityToken := os.Getenv("YNX_SOCIAL_CLOUD_AUTHORITY_TOKEN")
	if cloudAuthorityToken != "" && (len(cloudAuthorityToken) < 32 || strings.TrimSpace(cloudAuthorityToken) != cloudAuthorityToken) {
		log.Fatal("YNX_SOCIAL_CLOUD_AUTHORITY_TOKEN must contain at least 32 characters without surrounding whitespace")
	}
	if len(serviceKey) < 16 || strings.TrimSpace(*stateDir) == "" || rateMax <= 0 || rateMax > 10000 {
		log.Fatal("Social state directory, internal API key (at least 16 characters), and bounded rate limit are required")
	}
	matrixDirectory, err := loadMatrixDirectory(strings.TrimSpace(os.Getenv("YNX_SOCIAL_MATRIX_DIRECTORY")))
	if err != nil {
		log.Fatal("YNX_SOCIAL_MATRIX_DIRECTORY must contain validated existing public Matrix identity bindings")
	}
	productSessions, webProductClient, err := newSocialProductClients()
	if err != nil {
		log.Fatal(err)
	}
	revalidator, err := loadSocialRevalidator(webProductClient, os.Getenv("YNX_SOCIAL_REVALIDATION_KEY_ID"), os.Getenv("YNX_SOCIAL_REVALIDATION_PRIVATE_KEY_FILE"))
	if err != nil {
		log.Fatal(socialRevalidationConfigMessage)
	}
	if *checkConfig {
		fmt.Printf("ynx-sociald config check passed; revalidation configured=%t; runtime authority not verified\n", revalidator != nil)
		return
	}
	if err := os.MkdirAll(*stateDir, 0o700); err != nil {
		log.Fatal(err)
	}
	chatService, err := chat.New(chat.Config{StatePath: filepath.Join(*stateDir, "chat.json"), APIKey: serviceKey, MaxCiphertextBytes: 64 * 1024, RemoteDeployed: true, RateLimitMax: rateMax, RateLimitWindow: rateWindow})
	if err != nil {
		log.Fatal(err)
	}
	squareService, err := square.New(square.Config{StatePath: filepath.Join(*stateDir, "square.json"), APIKey: serviceKey, MaxBodyBytes: 1024 * 1024, RemoteDeployed: true, RateLimitMax: rateMax, RateLimitWindow: rateWindow})
	if err != nil {
		log.Fatal(err)
	}
	browserSSO, err := productsessionv2.NewBrowserSSO("social", "https://wallet-auth.ynxweb4.com", tokenKey, []string{"profile", "conversations"}, nil)
	if err != nil {
		log.Fatal(err)
	}
	socialService, err := social.New(social.Config{StatePath: filepath.Join(*stateDir, "social.json"), TokenKey: tokenKey, RateLimitMax: rateMax, RateLimitWindow: rateWindow, Chat: chatService, Square: squareService, BrowserSSO: browserSSO, ProductSessions: productSessions, MatrixDirectory: matrixDirectory, MatrixAudienceActionVerifier: socialAudienceActionVerifier{}, MatrixAudienceSessionRevalidator: revalidator})
	if err != nil {
		log.Fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	socialServer := social.NewServer(socialService, socialService)
	if cloudAuthorityToken != "" {
		authority, err := social.NewCloudObjectAuthority(socialService, cloudAuthorityToken)
		if err != nil {
			log.Fatal(err)
		}
		socialServer, err = social.NewServerWithCloudObjects(socialService, socialService, authority)
		if err != nil {
			log.Fatal(err)
		}
	}
	server := &http.Server{Addr: *httpAddr, Handler: mutationfreeze.FromEnv(socialServer.Handler()), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 45 * time.Second, WriteTimeout: 45 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 * 1024}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	log.Printf("YNX Social listening on http://%s; Wallet-bound sessions and isolated persistent Social/Chat/Square state enabled", *httpAddr)
	if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func decodeKey(name string) ([]byte, error) {
	value := strings.TrimSpace(os.Getenv(name))
	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) < 32 {
		return nil, fmt.Errorf("%s must be hex encoding of at least 32 bytes", name)
	}
	return decoded, nil
}

// The deployment owner supplies a public, existing-user mapping, not secrets.
// Absence keeps legacy service operational but Matrix metadata fails closed.
func loadMatrixDirectory(path string) (*social.MatrixDirectory, error) {
	if path == "" {
		return nil, nil
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return social.ParseMatrixDirectory(file)
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) (int, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer", key)
	}
	return parsed, nil
}
