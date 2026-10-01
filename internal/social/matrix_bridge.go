package social

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// MatrixBridge deliberately delegates existing Wallet/SSO/proof/CSRF validation.
// Configure Authorize from the existing Social authority, never from client JSON.
// No admin token, wallet secret or chat private key belongs in this bridge.
type MatrixBridge struct {
	AllowPeer func(context.Context, string, string) error
	Authorize func(*http.Request, []string) (string, error)
	Resolve   func(context.Context, string) (MatrixServer, error)
	Issue     func(context.Context, string, string, MatrixServer) (MatrixCredential, error)
	LocalQA   bool
}
type MatrixServer struct {
	BaseURL    string
	ServerName string
}
type MatrixCredential struct {
	AccessToken string
	ExpiresAt   time.Time
}
type MatrixBinding struct {
	Protocol    string    `json:"protocol"`
	Account     string    `json:"account"`
	Homeserver  string    `json:"homeserver"`
	ServerName  string    `json:"serverName"`
	UserID      string    `json:"userId"`
	DeviceID    string    `json:"deviceId"`
	AccessToken string    `json:"accessToken,omitempty"`
	ExpiresAt   time.Time `json:"expiresAt,omitempty"`
}

var matrixAccount = regexp.MustCompile(`^ynx1[0-9a-z]{38}$`)
var matrixDevice = regexp.MustCompile(`^[A-Za-z0-9._-]{3,64}$`)
var matrixServerName = regexp.MustCompile(`^[a-zA-Z0-9.-]+(:[0-9]{1,5})?$`)

func (b *MatrixBridge) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	deny := func(status int) {
		w.WriteHeader(status)
		_, _ = io.WriteString(w, `{"error":"verified Matrix binding unavailable"}`)
	}
	if b.Authorize == nil || b.Resolve == nil {
		deny(http.StatusServiceUnavailable)
		return
	}
	account, err := b.Authorize(r, []string{"social.contacts", "social.messaging"})
	if err != nil || !matrixAccount.MatchString(account) {
		deny(http.StatusUnauthorized)
		return
	}
	peer := r.URL.Path == "/social/v3/matrix/peer"
	if peer && r.Method != http.MethodGet || !peer && (r.URL.Path != "/social/v3/matrix/session" || r.Method != http.MethodPost) {
		deny(http.StatusMethodNotAllowed)
		return
	}
	deviceID := ""
	if peer {
		actor := account
		account = r.URL.Query().Get("account")
		if !matrixAccount.MatchString(account) {
			deny(http.StatusBadRequest)
			return
		}
		if b.AllowPeer == nil || b.AllowPeer(r.Context(), actor, account) != nil {
			deny(http.StatusForbidden)
			return
		}
	} else {
		var input struct {
			DeviceID string `json:"deviceId"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&input) != nil || !matrixDevice.MatchString(input.DeviceID) || decoder.Decode(new(any)) != io.EOF {
			deny(http.StatusBadRequest)
			return
		}
		deviceID = input.DeviceID
	}
	server, err := b.Resolve(r.Context(), account)
	if err != nil || b.validateServer(server) != nil {
		deny(http.StatusServiceUnavailable)
		return
	}
	result := MatrixBinding{Protocol: "ynx-social-matrix/v1", Account: account, Homeserver: server.BaseURL, ServerName: server.ServerName, UserID: "@" + account + ":" + server.ServerName, DeviceID: deviceID}
	if !peer {
		if b.Issue == nil {
			deny(http.StatusServiceUnavailable)
			return
		}
		credential, err := b.Issue(r.Context(), account, deviceID, server)
		if err != nil || credential.AccessToken == "" || len(credential.AccessToken) > 8192 || !credential.ExpiresAt.After(time.Now()) || credential.ExpiresAt.After(time.Now().Add(24*time.Hour)) {
			deny(http.StatusServiceUnavailable)
			return
		}
		if b.validateWhoAmI(r.Context(), result, credential.AccessToken) != nil {
			deny(http.StatusUnauthorized)
			return
		}
		result.AccessToken = credential.AccessToken
		result.ExpiresAt = credential.ExpiresAt
	}
	_ = json.NewEncoder(w).Encode(result)
}
func (b *MatrixBridge) validateServer(server MatrixServer) error {
	u, err := url.Parse(server.BaseURL)
	if err != nil || !matrixServerName.MatchString(server.ServerName) || u.Host == "" || u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && !(b.LocalQA && u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost"))) {
		return errors.New("invalid fixed Matrix server")
	}
	return nil
}
func (b *MatrixBridge) validateWhoAmI(ctx context.Context, binding MatrixBinding, token string) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(binding.Homeserver, "/")+"/_matrix/client/v3/account/whoami", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	client := http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	var identity struct {
		UserID   string `json:"user_id"`
		DeviceID string `json:"device_id"`
	}
	if response.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&identity) != nil || identity.UserID != binding.UserID || identity.DeviceID != binding.DeviceID {
		return errors.New("Matrix issuer identity mismatch")
	}
	return nil
}
