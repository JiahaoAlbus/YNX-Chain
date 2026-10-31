// ynx-secure-link is a fixed service-edge proxy. Its ingress speaks native S3
// mTLS and forwards to one private local Unix socket. Its egress accepts one OS
// principal over a private socket and speaks native S3 to one fixed service.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)

type config struct {
	Mode        string            `json:"mode"`
	TLS         native.Config     `json:"tls"`
	Policy      securelink.Policy `json:"policy"`
	EdgeID      string            `json:"edgeId"`
	ListenTCP   string            `json:"listenTCP"`
	ListenUnix  string            `json:"listenUnix"`
	PeerUID     *uint32           `json:"peerUID"`
	BackendUnix string            `json:"backendUnix"`
	BackendUID  *uint32           `json:"backendUID"`
	Address     string            `json:"address"`
	Origin      string            `json:"origin"`
}

func readConfig(path string) (config, error) {
	var cfg config
	if path == "" {
		return cfg, errors.New("-config is required")
	}
	f, err := os.Open(path)
	if err != nil {
		return cfg, err
	}
	defer f.Close()
	wire, err := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if err != nil {
		return cfg, err
	}
	if len(wire) > 1<<20 {
		return cfg, securelink.ErrBounds
	}
	d := json.NewDecoder(bytes.NewReader(wire))
	d.DisallowUnknownFields()
	if err = d.Decode(&cfg); err != nil {
		return cfg, err
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return cfg, errors.New("config must contain one JSON object")
	}
	return cfg, nil
}
func main() {
	path := flag.String("config", "", "service-edge configuration file (paths only, no private key bytes)")
	flag.Parse()
	cfg, err := readConfig(*path)
	if err == nil {
		err = run(cfg)
	}
	if err != nil {
		log.Printf("secure link stopped: %v", err)
		os.Exit(1)
	}
}

func run(cfg config) error {
	gate, err := securelink.NewGate(cfg.Policy)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	switch cfg.Mode {
	case "egress":
		if cfg.PeerUID == nil || cfg.TLS.Server || cfg.ListenUnix == "" || cfg.ListenTCP != "" || cfg.BackendUnix != "" {
			return securelink.ErrDenied
		}
		transport, err := securelink.NewTransport(securelink.HTTPClientConfig{TLS: cfg.TLS, Gate: gate, EdgeID: cfg.EdgeID, Address: cfg.Address, Origin: cfg.Origin})
		if err != nil {
			return err
		}
		defer transport.Close()
		origin, err := url.Parse(cfg.Origin)
		if err != nil {
			return err
		}
		proxy := fixedProxy(origin, transport)
		listener, err := securelink.ListenPrivate(cfg.ListenUnix, *cfg.PeerUID)
		if err != nil {
			return err
		}
		defer listener.Close()
		server := &http.Server{Handler: proxy, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: time.Minute, MaxHeaderBytes: 64 << 10}
		go func() {
			<-ctx.Done()
			shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = server.Shutdown(shutdown)
		}()
		err = server.Serve(listener)
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case "ingress":
		if cfg.BackendUID == nil || !cfg.TLS.Server || cfg.ListenTCP == "" || cfg.ListenUnix != "" || cfg.Origin != "" || cfg.Address != "" {
			return securelink.ErrDenied
		}
		backend, err := securelink.NewIPCBackend(cfg.BackendUnix, *cfg.BackendUID)
		if err != nil {
			return err
		}
		defer backend.CloseIdleConnections()
		server, err := securelink.NewHTTPServer(securelink.HTTPServerConfig{TLS: cfg.TLS, Gate: gate, EdgeID: cfg.EdgeID, Handler: fixedProxy(&url.URL{Scheme: "http", Host: "edge-private-ipc"}, backend)})
		if err != nil {
			return err
		}
		defer server.Close()
		listener, err := net.Listen("tcp", cfg.ListenTCP)
		if err != nil {
			return err
		}
		defer listener.Close()
		go func() {
			<-ctx.Done()
			shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = server.Shutdown(shutdown)
		}()
		err = server.Serve(listener)
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	default:
		return fmt.Errorf("%w: mode must be ingress or egress", securelink.ErrDenied)
	}
}
func fixedProxy(target *url.URL, transport http.RoundTripper) http.Handler {
	proxy := &httputil.ReverseProxy{Transport: transport, Rewrite: func(p *httputil.ProxyRequest) {
		p.Out.URL.Scheme = target.Scheme
		p.Out.URL.Host = target.Host
		p.Out.Host = target.Host
		p.Out.Header.Del("Forwarded")
		p.Out.Header.Del("X-Forwarded-For")
		p.Out.Header.Del("X-Forwarded-Host")
		p.Out.Header.Del("X-Forwarded-Proto")
	}, ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
		http.Error(w, "protected service unavailable; reconcile original operation before retry", http.StatusBadGateway)
	}}
	return proxy
}
