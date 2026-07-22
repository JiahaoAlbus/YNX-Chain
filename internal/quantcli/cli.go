package quantcli

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var ErrUsage = errors.New("usage")

type CLI struct {
	BaseURL string
	Client  *http.Client
	Out     io.Writer
}

func (c CLI) Run(args []string) error {
	if c.Client == nil {
		c.Client = &http.Client{Timeout: 10 * time.Second}
	}
	if c.Out == nil {
		c.Out = io.Discard
	}
	if len(args) == 0 {
		return ErrUsage
	}
	method, path := http.MethodGet, ""
	var payload any
	switch args[0] {
	case "health":
		path = "/health"
	case "snapshot":
		path = "/v1/snapshot"
	case "kill":
		if len(args) != 3 || args[1] != "--approve" || len(strings.TrimSpace(args[2])) < 3 {
			return ErrUsage
		}
		method, path, payload = http.MethodPost, "/v1/risk/kill", map[string]string{"reason": args[2]}
	case "revoke-mandate":
		if len(args) != 4 || args[1] != "--approve" || len(args[2]) != 64 || len(strings.TrimSpace(args[3])) < 3 {
			return ErrUsage
		}
		method, path, payload = http.MethodPost, "/v1/testnet/mandates/"+url.PathEscape(args[2])+"/revoke", map[string]string{"actor": args[3]}
	default:
		return ErrUsage
	}
	base := strings.TrimRight(c.BaseURL, "/")
	if base == "" {
		base = "http://127.0.0.1:6444"
	}
	if method != http.MethodGet && !loopbackURL(base) {
		return errors.New("mutations require a loopback service endpoint")
	}
	var body io.Reader
	if payload != nil {
		encoded, _ := json.Marshal(payload)
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequest(method, base+path, body)
	if err != nil {
		return err
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-YNX-Preview-Mode", "local-paper")
	}
	response, err := c.Client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("service returned HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(data)))
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return errors.New("service returned invalid JSON")
	}
	pretty, _ := json.MarshalIndent(value, "", "  ")
	_, err = fmt.Fprintln(c.Out, string(pretty))
	return err
}

func loopbackURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil {
		return false
	}
	host := u.Hostname()
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
