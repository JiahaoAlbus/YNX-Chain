package faucet

import (
	"encoding/json"
	"html/template"
	"io"
	"net"
	"net/http"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

const MaxRequestBodyBytes = 16 * 1024

var publicFaucetPage = template.Must(template.New("faucet").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>YNX Testnet Faucet</title><style>body{margin:0;background:#f8fafc;color:#101828;font:16px system-ui,sans-serif}main{max-width:560px;margin:8vh auto;padding:32px;background:#fff;border:1px solid #e4e7ec;border-radius:20px}h1{margin:0 0 8px}p{line-height:1.5;color:#475467}label{display:block;font-weight:600;margin:24px 0 8px}input,button{box-sizing:border-box;width:100%;padding:13px;border-radius:10px;font:inherit}input{border:1px solid #98a2b3}button{border:0;background:#123bb6;color:#fff;font-weight:700;cursor:pointer;margin-top:16px}#result{white-space:pre-wrap;margin-top:18px;color:#344054}</style></head>
<body><main><h1>YNX Testnet Faucet</h1><p>Request test-only YNXT for the YNX Testnet. One request per address and network identity is rate-limited. Never enter a recovery key.</p><label for="address">YNX wallet address</label><input id="address" autocomplete="off" spellcheck="false" placeholder="ynx1…"><button id="request" type="button">Request test YNXT</button><p id="result" role="status"></p></main><script>const address=document.getElementById('address'),result=document.getElementById('result'),button=document.getElementById('request');button.addEventListener('click',async()=>{button.disabled=true;result.textContent='Requesting test YNXT…';try{const r=await fetch('/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:address.value.trim()})}),j=await r.json();if(!r.ok)throw new Error(typeof j.error==='string'?j.error:'Request was rejected');result.textContent='Testnet request accepted. Transaction: '+j.transaction.hash}catch(e){result.textContent='Request unavailable: '+(e instanceof Error?e.message:'unknown error')}finally{button.disabled=false}})</script></body></html>`))

type Server struct {
	service *Service
	mux     *http.ServeMux
	build   buildinfo.Info
}

func NewServer(service *Service) *Server {
	return NewServerWithBuild(service, buildinfo.Info{})
}

func NewServerWithBuild(service *Service, build buildinfo.Info) *Server {
	s := &Server{service: service, mux: http.NewServeMux(), build: buildinfo.Normalize(build)}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if allowedWebsiteOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			if !allowedWebsiteOrigin(origin) {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		s.mux.ServeHTTP(w, r)
	})
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /", s.handlePublicPage)
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("GET /metrics", s.handleMetrics)
	s.mux.HandleFunc("POST /faucet", s.handleRequest)
	s.mux.HandleFunc("POST /request", s.handleRequest)
}

type PublicHealth struct {
	OK             bool           `json:"ok"`
	Service        string         `json:"service"`
	UpstreamMode   string         `json:"upstreamMode"`
	UpstreamOK     bool           `json:"upstreamOk"`
	ChainID        int64          `json:"chainId,omitempty"`
	Height         uint64         `json:"height,omitempty"`
	NativeSymbol   string         `json:"nativeSymbol"`
	DefaultAmount  int64          `json:"defaultAmount"`
	MaxAmount      int64          `json:"maxAmount"`
	RateLimit      string         `json:"rateLimit"`
	RequestPath    string         `json:"requestPath"`
	Build          buildinfo.Info `json:"build"`
	TruthfulStatus string         `json:"truthfulStatus"`
}

func publicHealth(health Health) PublicHealth {
	return PublicHealth{
		OK: health.OK, Service: health.Service, UpstreamMode: health.UpstreamMode,
		UpstreamOK: health.UpstreamOK, ChainID: health.ChainID, Height: health.Height,
		NativeSymbol: health.NativeSymbol, DefaultAmount: health.DefaultAmount,
		MaxAmount: health.MaxAmount, RateLimit: health.RateLimit, RequestPath: "/request",
		Build: health.Build, TruthfulStatus: health.TruthfulStatus,
	}
}

func (s *Server) handlePublicPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = publicFaucetPage.Execute(w, nil)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	health := s.service.CheckHealth(r.Context())
	health.Build = s.build
	status := http.StatusOK
	if !health.OK {
		status = http.StatusBadGateway
	}
	writeJSON(w, status, publicHealth(health))
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = w.Write([]byte(s.service.Metrics()))
}

func (s *Server) handleRequest(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxRequestBodyBytes)
	var req Request
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json"})
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json"})
		return
	}
	resp, status, err := s.service.Request(r.Context(), req, requestClientIdentity(r))
	if err != nil {
		writeJSON(w, status, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, status, resp)
}

func allowedWebsiteOrigin(origin string) bool {
	switch origin {
	case "https://ynxweb4.com", "https://www.ynxweb4.com":
		return true
	default:
		return false
	}
}

func requestClientIdentity(r *http.Request) string {
	realIP := strings.TrimSpace(r.Header.Get("X-Real-IP"))
	if parsed := net.ParseIP(realIP); parsed != nil {
		return parsed.String()
	}
	return r.RemoteAddr
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
