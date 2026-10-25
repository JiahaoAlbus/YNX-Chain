package main

import (
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/yusdsandbox"
)

func main() {
	addr := strings.TrimSpace(os.Getenv("YNX_YUSD_SANDBOX_ADDR"))
	if addr == "" {
		addr = "127.0.0.1:6490"
	}
	service, err := yusdsandbox.New(yusdsandbox.Config{StatePath: os.Getenv("YNX_YUSD_SANDBOX_STATE_PATH"), APIKey: os.Getenv("YNX_YUSD_SANDBOX_API_KEY")})
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: addr, Handler: yusdsandbox.NewServer(service).Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("YUSD Sandbox listening on %s (testnet-only, no real value)", addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
