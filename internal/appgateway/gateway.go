package appgateway

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Config struct {
	ChatURL          string
	ChatAPIKey       string
	SquareURL        string
	SquareAPIKey     string
	AllowedOrigins   []string
	MaxBodyBytes     int64
	MaxResponseBytes int64
	RateLimitMax     int
	RateLimitWindow  time.Duration
	StatePath        string
	ChainID          int64
	ChallengeTTL     time.Duration
	SessionTTL       time.Duration
	RemoteDeployed   bool
	Now              func() time.Time
	Random           io.Reader
}

type Gateway struct {
	cfg       Config
	chatURL   *url.URL
	squareURL *url.URL
	origins   map[string]struct{}
	mu        sync.Mutex
	visitors  map[string]visitor
	stateMu   sync.Mutex
	state     persistentState
}

type visitor struct {
	window time.Time
	count  int
}

func New(cfg Config) (*Gateway, error) {
	if err := ValidateConfig(cfg); err != nil {
		return nil, err
	}
	chatURL, _ := url.Parse(cfg.ChatURL)
	squareURL, _ := url.Parse(cfg.SquareURL)
	origins := make(map[string]struct{}, len(cfg.AllowedOrigins))
	for _, origin := range cfg.AllowedOrigins {
		origins[strings.TrimSpace(origin)] = struct{}{}
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Random == nil {
		cfg.Random = rand.Reader
	}
	state, exists, err := loadState(cfg.StatePath)
	if err != nil {
		return nil, err
	}
	gateway := &Gateway{cfg: cfg, chatURL: chatURL, squareURL: squareURL, origins: origins, visitors: map[string]visitor{}, state: state}
	if !exists {
		if err := saveState(cfg.StatePath, &gateway.state); err != nil {
			return nil, err
		}
	}
	return gateway, nil
}

func ValidateConfig(cfg Config) error {
	if err := validateLoopbackURL("YNX_APP_GATEWAY_CHAT_URL", cfg.ChatURL); err != nil {
		return err
	}
	if err := validateLoopbackURL("YNX_APP_GATEWAY_SQUARE_URL", cfg.SquareURL); err != nil {
		return err
	}
	if len(strings.TrimSpace(cfg.ChatAPIKey)) < 16 {
		return errors.New("YNX_APP_GATEWAY_CHAT_API_KEY must contain at least 16 characters")
	}
	if len(strings.TrimSpace(cfg.SquareAPIKey)) < 16 {
		return errors.New("YNX_APP_GATEWAY_SQUARE_API_KEY must contain at least 16 characters")
	}
	if len(cfg.AllowedOrigins) == 0 {
		return errors.New("YNX_APP_GATEWAY_ALLOWED_ORIGINS must contain at least one exact HTTPS origin")
	}
	seen := map[string]struct{}{}
	for _, raw := range cfg.AllowedOrigins {
		origin := strings.TrimSpace(raw)
		parsed, err := url.Parse(origin)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
			return fmt.Errorf("invalid allowed origin %q: exact HTTPS origins only", raw)
		}
		if _, ok := seen[origin]; ok {
			return fmt.Errorf("duplicate allowed origin %q", origin)
		}
		seen[origin] = struct{}{}
	}
	if cfg.MaxBodyBytes < 1024 || cfg.MaxBodyBytes > 1024*1024 {
		return errors.New("YNX_APP_GATEWAY_MAX_BODY_BYTES must be between 1024 and 1048576")
	}
	if cfg.MaxResponseBytes < 1024 || cfg.MaxResponseBytes > 4*1024*1024 {
		return errors.New("YNX_APP_GATEWAY_MAX_RESPONSE_BYTES must be between 1024 and 4194304")
	}
	if cfg.RateLimitMax < 1 || cfg.RateLimitMax > 10000 {
		return errors.New("YNX_APP_GATEWAY_RATE_LIMIT_MAX must be between 1 and 10000")
	}
	if cfg.RateLimitWindow < time.Second || cfg.RateLimitWindow > time.Hour {
		return errors.New("YNX_APP_GATEWAY_RATE_LIMIT_WINDOW must be between 1s and 1h")
	}
	if strings.TrimSpace(cfg.StatePath) == "" || !filepath.IsAbs(cfg.StatePath) || filepath.Clean(cfg.StatePath) == string(filepath.Separator) {
		return errors.New("YNX_APP_GATEWAY_STATE_PATH must be an absolute file path")
	}
	if cfg.ChainID <= 0 {
		return errors.New("YNX_APP_GATEWAY_CHAIN_ID must be positive")
	}
	if cfg.ChallengeTTL < time.Minute || cfg.ChallengeTTL > 15*time.Minute {
		return errors.New("YNX_APP_GATEWAY_CHALLENGE_TTL must be between 1m and 15m")
	}
	if cfg.SessionTTL < 5*time.Minute || cfg.SessionTTL > 24*time.Hour {
		return errors.New("YNX_APP_GATEWAY_SESSION_TTL must be between 5m and 24h")
	}
	return nil
}

func validateLoopbackURL(name, raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "http" || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("%s must be an exact loopback HTTP origin", name)
	}
	host := parsed.Hostname()
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return fmt.Errorf("%s must use a loopback host", name)
	}
	return nil
}

func (g *Gateway) OriginAllowed(origin string) bool {
	_, ok := g.origins[strings.TrimSpace(origin)]
	return ok
}

func (g *Gateway) Allow(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	now := g.cfg.Now().UTC()
	g.mu.Lock()
	defer g.mu.Unlock()
	entry := g.visitors[host]
	if entry.window.IsZero() || now.Sub(entry.window) >= g.cfg.RateLimitWindow {
		g.visitors[host] = visitor{window: now, count: 1}
		return true
	}
	if entry.count >= g.cfg.RateLimitMax {
		return false
	}
	entry.count++
	g.visitors[host] = entry
	return true
}

func (g *Gateway) upstream(service string) (*url.URL, string, string, bool) {
	switch service {
	case "chat":
		return g.chatURL, g.cfg.ChatAPIKey, "X-YNX-Chat-Key", true
	case "square":
		return g.squareURL, g.cfg.SquareAPIKey, "X-YNX-Square-Key", true
	default:
		return nil, "", "", false
	}
}

func publicRouteAllowed(service, method, path string) bool {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 2 || parts[0] != service {
		return false
	}
	if service == "square" {
		switch {
		case len(parts) == 2 && parts[1] == "feed":
			return method == "GET"
		case len(parts) == 3 && parts[1] == "posts":
			return method == "GET" && validSegment(parts[2])
		case len(parts) == 4 && parts[1] == "posts" && parts[3] == "comments":
			return method == "GET" && validSegment(parts[2])
		case len(parts) == 4 && parts[1] == "profiles" && parts[3] == "following":
			return method == "GET" && validSegment(parts[2])
		}
	}
	return false
}

func protectedRouteAllowed(service, method, path string) bool {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 2 || parts[0] != service {
		return false
	}
	switch service {
	case "chat":
		switch {
		case len(parts) == 2 && parts[1] == "devices":
			return method == "POST"
		case len(parts) == 4 && parts[1] == "devices" && parts[3] == "revoke":
			return method == "POST" && validSegment(parts[2])
		case len(parts) == 2 && parts[1] == "conversations":
			return method == "POST"
		case len(parts) == 3 && parts[1] == "conversations":
			return method == "GET" && validSegment(parts[2])
		case len(parts) == 4 && parts[1] == "conversations" && parts[3] == "messages":
			return (method == "GET" || method == "POST") && validSegment(parts[2])
		case len(parts) == 6 && parts[1] == "conversations" && parts[3] == "messages":
			return method == "POST" && validSegment(parts[2]) && validSegment(parts[4]) && (parts[5] == "delivered" || parts[5] == "read")
		}
	case "square":
		switch {
		case len(parts) == 2 && parts[1] == "devices":
			return method == "POST"
		case len(parts) == 4 && parts[1] == "devices" && parts[3] == "revoke":
			return method == "POST" && validSegment(parts[2])
		case len(parts) == 2 && (parts[1] == "posts" || parts[1] == "follows" || parts[1] == "reports"):
			return method == "POST"
		case len(parts) == 3 && parts[1] == "reports":
			return method == "GET" && validSegment(parts[2])
		case len(parts) == 4 && parts[1] == "posts" && (parts[3] == "comments" || parts[3] == "reactions"):
			return method == "POST" && validSegment(parts[2])
		}
	}
	return false
}

func validSegment(value string) bool {
	if value == "" || len(value) > 128 || value == "." || value == ".." || strings.ContainsAny(value, "\\?#%") {
		return false
	}
	for _, r := range value {
		if !(r >= 'a' && r <= 'z') && !(r >= 'A' && r <= 'Z') && !(r >= '0' && r <= '9') && r != '-' && r != '_' {
			return false
		}
	}
	return true
}
