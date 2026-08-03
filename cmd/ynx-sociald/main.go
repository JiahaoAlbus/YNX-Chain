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
	if len(serviceKey) < 16 || strings.TrimSpace(*stateDir) == "" || rateMax <= 0 || rateMax > 10000 {
		log.Fatal("Social state directory, internal API key (at least 16 characters), and bounded rate limit are required")
	}
	if *checkConfig {
		fmt.Println("ynx-sociald config check passed; isolated persistent Chat/Square composition and Wallet-bound Social sessions enabled")
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
	socialService, err := social.New(social.Config{StatePath: filepath.Join(*stateDir, "social.json"), TokenKey: tokenKey, RateLimitMax: rateMax, RateLimitWindow: rateWindow, Chat: chatService, Square: squareService})
	if err != nil {
		log.Fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	server := &http.Server{Addr: *httpAddr, Handler: mutationfreeze.FromEnv(social.NewServer(socialService, socialService).Handler()), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 45 * time.Second, WriteTimeout: 45 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 * 1024}
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
