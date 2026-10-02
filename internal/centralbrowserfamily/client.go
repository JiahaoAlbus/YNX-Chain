package centralbrowserfamily

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"sync"
	"syscall"
	"time"
)

const issuer = "https://wallet-auth.ynxweb4.com"

var opaque = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
var account = regexp.MustCompile(`^ynx1[0-9a-z]{38}$`)
var digest = regexp.MustCompile(`^[a-f0-9]{64}$`)
var errorCode = regexp.MustCompile(`^SSO_[A-Z0-9_]{1,64}$`)

type flight struct {
	done  chan struct{}
	grant Grant
	err   error
}
type Client struct {
	cfg     Config
	key     ed25519.PrivateKey
	store   *durableStore
	mu      sync.Mutex
	flights map[string]*flight
}

var _ Backend = (*Client)(nil)

func NewClient(cfg Config) (*Client, error) {
	if cfg.Issuer != issuer || cfg.ClientID != "ynx-finance-v1-sso-v1" || cfg.Origin != "https://finance.ynxweb4.com" || cfg.RedirectURI != cfg.Origin+"/sso/callback" || cfg.Audience != "ynx:finance:identity" || cfg.KeyID == "" {
		return nil, &Error{Code: CodeConfiguration}
	}
	keyBytes, err := protectedRead(cfg.PrivateKeyPath, 8192)
	if err != nil {
		return nil, err
	}
	block, rest := pem.Decode(keyBytes)
	if block == nil || block.Type != "PRIVATE KEY" || len(bytes.TrimSpace(rest)) != 0 {
		return nil, &Error{Code: CodeConfiguration}
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, &Error{Code: CodeConfiguration}
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, &Error{Code: CodeConfiguration}
	}
	sealKey, err := protectedRead(cfg.SealKeyPath, 32)
	if err != nil || len(sealKey) != 32 {
		return nil, &Error{Code: CodeConfiguration}
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	httpClient := http.Client{Timeout: 5 * time.Second}
	if cfg.HTTPClient != nil {
		httpClient = *cfg.HTTPClient
		if httpClient.Timeout <= 0 || httpClient.Timeout > 5*time.Second {
			httpClient.Timeout = 5 * time.Second
		}
	}
	httpClient.CheckRedirect = func(*http.Request, []*http.Request) error { return errors.New("redirect refused") }
	cfg.HTTPClient = &httpClient
	store, err := openStore(cfg.StorePath, sealKey, cfg.Issuer+"\n"+cfg.ClientID+"\n"+cfg.Origin+"\n"+cfg.Audience)
	if err != nil {
		return nil, err
	}
	return &Client{cfg: cfg, key: key, store: store, flights: map[string]*flight{}}, nil
}
func (c *Client) Close() error { return c.store.close() }
func protectedRead(path string, limit int64) ([]byte, error) {
	if !filepath.IsAbs(path) {
		return nil, &Error{Code: CodeConfiguration}
	}
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, &Error{Code: CodeConfiguration}
	}
	file := os.NewFile(uintptr(fd), path)
	defer file.Close()
	st, err := file.Stat()
	if err != nil || !st.Mode().IsRegular() || st.Mode().Perm() != 0600 || st.Size() > limit {
		return nil, &Error{Code: CodeConfiguration}
	}
	stat, ok := st.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Getuid()) || stat.Nlink != 1 {
		return nil, &Error{Code: CodeConfiguration}
	}
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(data)) > limit {
		return nil, &Error{Code: CodeConfiguration}
	}
	return data, nil
}
func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func canonical(v any) ([]byte, error) {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	if err := e.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(b.Bytes(), []byte("\n")), nil
}
func stamp(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }
func (c *Client) call(ctx context.Context, path string, body map[string]any, out any) error {
	raw, err := canonical(body)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(raw)
	proof := map[string]any{"version": 1, "issuer": c.cfg.Issuer, "audience": c.cfg.Issuer + "/v2/browser-sessions", "clientId": c.cfg.ClientID, "keyId": c.cfg.KeyID, "method": "POST", "path": path, "bodySha256": hex.EncodeToString(sum[:]), "issuedAt": stamp(c.cfg.Now()), "nonce": randomToken()}
	signed, err := canonical(proof)
	if err != nil {
		return err
	}
	proof["signature"] = base64.RawURLEncoding.EncodeToString(ed25519.Sign(c.key, signed))
	proofRaw, err := canonical(proof)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.Issuer+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-Backend-Proof", base64.RawURLEncoding.EncodeToString(proofRaw))
	req.Header.Set("Cache-Control", "no-store")
	resp, err := c.cfg.HTTPClient.Do(req)
	if err != nil {
		return &Error{Code: CodeUnavailable}
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 65537))
	if err != nil || len(data) > 65536 {
		return &Error{Code: CodeUnavailable}
	}
	if resp.StatusCode != 200 {
		var failure struct {
			Code  string `json:"code"`
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if json.Unmarshal(data, &failure) == nil {
			code := failure.Error.Code
			if code == "" {
				code = failure.Code
			}
			if errorCode.MatchString(code) {
				return &Error{Code: code}
			}
		}
		return &Error{Code: CodeUnavailable}
	}
	if json.Unmarshal(data, out) != nil {
		return &Error{Code: CodeBinding}
	}
	return nil
}

type wireGrant struct {
	GrantToken            string    `json:"grantToken"`
	Identity              Identity  `json:"identity"`
	Audience              string    `json:"audience"`
	Scopes                []string  `json:"scopes"`
	ExpiresAt             time.Time `json:"expiresAt"`
	FamilyID              string    `json:"familyId"`
	FamilyEpoch           int64     `json:"familyEpoch"`
	RefreshHandle         string    `json:"refreshHandle"`
	AbsoluteExpiresAt     time.Time `json:"absoluteExpiresAt"`
	IdleExpiresAt         time.Time `json:"idleExpiresAt"`
	ApprovedProfile       int       `json:"approvedProfile"`
	ApprovedClientsDigest string    `json:"approvedClientsDigest"`
}

func (c *Client) validate(w wireGrant, prior *familyRecord) error {
	now := c.cfg.Now()
	if !opaque.MatchString(w.GrantToken) || !opaque.MatchString(w.FamilyID) || !opaque.MatchString(w.RefreshHandle) || !account.MatchString(w.Identity.Account) || w.Identity.Subject != w.Identity.Account || w.Identity.Generation < 1 || w.Audience != c.cfg.Audience || len(w.Scopes) != 1 || w.Scopes[0] != "identity:read" || !w.ExpiresAt.After(now) || w.ExpiresAt.After(now.Add(5*time.Minute)) || w.AbsoluteExpiresAt.After(now.Add(2*time.Hour)) || !w.AbsoluteExpiresAt.Equal(w.Identity.ExpiresAt) || w.ExpiresAt.After(w.IdleExpiresAt) || w.IdleExpiresAt.After(w.AbsoluteExpiresAt) || !w.IdleExpiresAt.After(now) || w.FamilyEpoch < 0 || (w.ApprovedProfile != 3 && w.ApprovedProfile != 5 && w.ApprovedProfile != 6) || !digest.MatchString(w.ApprovedClientsDigest) {
		return &Error{Code: CodeBinding}
	}
	if prior != nil && (w.FamilyID != prior.CentralID || w.FamilyEpoch != prior.Epoch+1 || w.Identity.Subject != prior.Grant.Identity.Subject || w.Identity.Account != prior.Grant.Identity.Account || w.Identity.Generation != prior.Grant.Identity.Generation || !w.AbsoluteExpiresAt.Equal(prior.Grant.AbsoluteExpiresAt) || strconv.Itoa(w.ApprovedProfile) != prior.Grant.ApprovedProfile || w.ApprovedClientsDigest != prior.Grant.ApprovedClientsDigest) {
		return &Error{Code: CodeBinding}
	}
	return nil
}
func grantFrom(w wireGrant, id string) Grant {
	return Grant{FamilyID: id, GrantToken: w.GrantToken, Identity: w.Identity, Audience: w.Audience, Scopes: append([]string(nil), w.Scopes...), ExpiresAt: w.ExpiresAt, AbsoluteExpiresAt: w.AbsoluteExpiresAt, IdleExpiresAt: w.IdleExpiresAt, ApprovedProfile: strconv.Itoa(w.ApprovedProfile), ApprovedClientsDigest: w.ApprovedClientsDigest}
}
func (c *Client) Prepare(ctx context.Context, input PrepareInput) (string, error) {
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	if !opaque.MatchString(input.State) || input.PreviousFamilyID != "" && !opaque.MatchString(input.PreviousFamilyID) {
		return "", &Error{Code: CodeBinding}
	}
	id := randomToken()
	err := c.store.update(func(s *durableState) error {
		s.collect(c.cfg.Now())
		if len(s.Intents) >= 4096 {
			return &Error{Code: CodeUnavailable}
		}
		if input.PreviousFamilyID != "" {
			old := s.Families[input.PreviousFamilyID]
			if old == nil || old.Fenced {
				return &Error{Code: CodeFenced, LocallyFenced: true}
			}
		}
		s.Intents[id] = &loginIntent{State: input.State, PreviousFamilyID: input.PreviousFamilyID, RequestID: randomToken(), Deadline: c.cfg.Now().Add(2 * time.Minute)}
		return nil
	})
	return id, err
}

// join coalesces only this local operation. Logout never waits for a network
// flight, so its durable fence always wins over a delayed response.
func (c *Client) join(ctx context.Context, key string, fn func() (Grant, error)) (Grant, error) {
	c.mu.Lock()
	if f := c.flights[key]; f != nil {
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			return Grant{}, ctx.Err()
		case <-f.done:
			return f.grant, f.err
		}
	}
	f := &flight{done: make(chan struct{})}
	c.flights[key] = f
	c.mu.Unlock()
	f.grant, f.err = fn()
	c.mu.Lock()
	delete(c.flights, key)
	close(f.done)
	c.mu.Unlock()
	return f.grant, f.err
}
func (c *Client) Redeem(ctx context.Context, input PKCEInput) (Grant, error) {
	if !opaque.MatchString(input.IntentID) || !opaque.MatchString(input.State) || !opaque.MatchString(input.Code) || !regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`).MatchString(input.CodeVerifier) {
		return Grant{}, &Error{Code: CodeBinding}
	}
	result, err := c.join(ctx, "redeem:"+input.IntentID, func() (Grant, error) {
		var saved loginIntent
		err := c.store.update(func(s *durableState) error {
			in := s.Intents[input.IntentID]
			if in == nil || in.Fenced {
				return &Error{Code: CodeFenced, LocallyFenced: true}
			}
			if in.State != input.State || !in.Deadline.After(c.cfg.Now()) {
				return &Error{Code: CodeBinding}
			}
			if in.Input != nil && *in.Input != input {
				return &Error{Code: CodeBinding}
			}
			copy := input
			in.Input = &copy
			saved = *in
			return nil
		})
		if err != nil {
			return Grant{}, err
		}
		if saved.ResultID != "" {
			return c.Resolve(ctx, saved.ResultID)
		}
		var w wireGrant
		err = c.call(ctx, "/v2/browser-sessions/token-family", map[string]any{"clientId": c.cfg.ClientID, "origin": c.cfg.Origin, "redirectUri": c.cfg.RedirectURI, "code": input.Code, "state": input.State, "codeVerifier": input.CodeVerifier, "requestId": saved.RequestID}, &w)
		if err != nil {
			return Grant{}, err
		}
		if err = c.validate(w, nil); err != nil {
			return Grant{}, err
		}
		if w.FamilyEpoch != 0 {
			return Grant{}, &Error{Code: CodeBinding}
		}
		localID := randomToken()
		fenced := false
		err = c.store.update(func(s *durableState) error {
			s.collect(c.cfg.Now())
			in := s.Intents[input.IntentID]
			fenced = in == nil || in.Fenced || !in.Deadline.After(c.cfg.Now())
			if len(s.Families) >= 4096 {
				return &Error{Code: CodeUnavailable}
			}
			record := &familyRecord{Grant: grantFrom(w, localID), CentralID: w.FamilyID, Handle: w.RefreshHandle, Epoch: 0, Fenced: fenced, IntentID: input.IntentID}
			if fenced {
				record.PendingRevoke = randomToken()
			}
			s.Families[localID] = record
			if in != nil {
				in.ResultID = localID
			}
			return nil
		})
		if err != nil {
			return Grant{}, err
		}
		if fenced {
			err = c.deliverRevoke(ctx, localID)
			return Grant{}, &Error{Code: CodeFenced, LocallyFenced: true, RevocationPending: err != nil}
		}
		return grantFrom(w, localID), nil
	})
	if err != nil {
		return Grant{}, err
	}
	err = c.store.view(func(s *durableState) error {
		in := s.Intents[input.IntentID]
		if in == nil || in.Fenced {
			return &Error{Code: CodeFenced, LocallyFenced: true}
		}
		if in.Input == nil || *in.Input != input || in.ResultID != result.FamilyID {
			return &Error{Code: CodeBinding}
		}
		return nil
	})
	if err != nil {
		return Grant{}, err
	}
	if _, err = c.readFamily(result.FamilyID); err != nil {
		return Grant{}, err
	}
	return result, nil
}
func (c *Client) readFamily(id string) (familyRecord, error) {
	var r familyRecord
	err := c.store.view(func(s *durableState) error {
		f := s.Families[id]
		if f == nil {
			return &Error{Code: CodeLoginRequired}
		}
		if f.Fenced {
			return &Error{Code: CodeFenced, LocallyFenced: true, RevocationPending: f.PendingRevoke != ""}
		}
		if !f.Grant.AbsoluteExpiresAt.After(c.cfg.Now()) || !f.Grant.IdleExpiresAt.After(c.cfg.Now()) {
			return &Error{Code: CodeLoginRequired}
		}
		r = *f
		return nil
	})
	return r, err
}
func (c *Client) Resolve(ctx context.Context, id string) (Grant, error) {
	if !opaque.MatchString(id) {
		return Grant{}, &Error{Code: CodeBinding}
	}
	result, err := c.join(ctx, "resolve:"+id, func() (Grant, error) {
		r, err := c.readFamily(id)
		if err != nil {
			return Grant{}, err
		}
		if r.PendingRenew != "" || !r.Grant.ExpiresAt.After(c.cfg.Now().Add(time.Minute)) {
			err = c.store.update(func(s *durableState) error {
				f := s.Families[id]
				if f == nil || f.Fenced || f.Epoch != r.Epoch {
					return &Error{Code: CodeFenced, LocallyFenced: true}
				}
				if f.PendingRenew == "" {
					f.PendingRenew = randomToken()
				}
				r = *f
				return nil
			})
			if err != nil {
				return Grant{}, err
			}
			var w wireGrant
			err = c.call(ctx, "/v2/browser-sessions/renew", map[string]any{"clientId": c.cfg.ClientID, "familyId": r.CentralID, "refreshHandle": r.Handle, "expectedFamilyEpoch": r.Epoch, "requestId": r.PendingRenew}, &w)
			if err != nil {
				return Grant{}, err
			}
			if err = c.validate(w, &r); err != nil {
				return Grant{}, err
			}
			err = c.store.update(func(s *durableState) error {
				f := s.Families[id]
				if f == nil || f.Fenced {
					return &Error{Code: CodeFenced, LocallyFenced: true}
				}
				if f.Epoch != r.Epoch || f.PendingRenew != r.PendingRenew {
					return &Error{Code: CodeConflict}
				}
				verifiedIdle := f.Grant.IdleExpiresAt
				f.Grant = grantFrom(w, id)
				if verifiedIdle.After(f.Grant.IdleExpiresAt) {
					f.Grant.IdleExpiresAt = verifiedIdle
				}
				f.Handle = w.RefreshHandle
				f.Epoch = w.FamilyEpoch
				f.PendingRenew = ""
				r = *f
				return nil
			})
			if err != nil {
				return Grant{}, err
			}
		}
		var verified struct {
			Identity  Identity  `json:"identity"`
			Audience  string    `json:"audience"`
			Scopes    []string  `json:"scopes"`
			ExpiresAt time.Time `json:"expiresAt"`
		}
		err = c.call(ctx, "/v2/browser-sessions/introspect", map[string]any{"clientId": c.cfg.ClientID, "grantToken": r.Grant.GrantToken}, &verified)
		if err != nil {
			return Grant{}, err
		}
		if verified.Identity != r.Grant.Identity || verified.Audience != r.Grant.Audience || len(verified.Scopes) != 1 || verified.Scopes[0] != "identity:read" || !verified.ExpiresAt.Equal(r.Grant.ExpiresAt) || !verified.ExpiresAt.After(c.cfg.Now()) {
			return Grant{}, &Error{Code: CodeBinding}
		}
		return r.Grant, nil
	})
	if err != nil {
		return Grant{}, err
	}
	current, err := c.readFamily(id)
	if err != nil {
		return Grant{}, err
	}
	if current.Grant.GrantToken != result.GrantToken {
		return Grant{}, &Error{Code: CodeConflict}
	}
	return result, nil
}
func (c *Client) Activity(ctx context.Context, id, eventID string, observed time.Time) error {
	if !opaque.MatchString(id) || !opaque.MatchString(eventID) || observed.After(c.cfg.Now()) || c.cfg.Now().Sub(observed) > 30*time.Second {
		return &Error{Code: CodeActivity}
	}
	r, err := c.readFamily(id)
	if err != nil {
		return err
	}
	var result struct {
		Identity          Identity  `json:"identity"`
		AbsoluteExpiresAt time.Time `json:"absoluteExpiresAt"`
		IdleExpiresAt     time.Time `json:"idleExpiresAt"`
	}
	err = c.call(ctx, "/v2/browser-sessions/activity", map[string]any{"clientId": c.cfg.ClientID, "familyId": r.CentralID, "eventId": eventID, "observedAt": stamp(observed)}, &result)
	if err != nil {
		return err
	}
	if result.Identity != r.Grant.Identity || !result.AbsoluteExpiresAt.Equal(r.Grant.AbsoluteExpiresAt) || result.IdleExpiresAt.After(result.AbsoluteExpiresAt) || result.IdleExpiresAt.After(observed.Add(30*time.Minute)) || result.IdleExpiresAt.Before(r.Grant.IdleExpiresAt) {
		return &Error{Code: CodeBinding}
	}
	return c.store.update(func(s *durableState) error {
		f := s.Families[id]
		if f == nil || f.Fenced {
			return &Error{Code: CodeFenced, LocallyFenced: true}
		}
		if f.Grant.Identity != r.Grant.Identity {
			return &Error{Code: CodeBinding}
		}
		if result.IdleExpiresAt.After(f.Grant.IdleExpiresAt) {
			f.Grant.IdleExpiresAt = result.IdleExpiresAt
		}
		return nil
	})
}
func (c *Client) Logout(ctx context.Context, input LogoutInput) error {
	if input.FamilyID == "" && input.IntentID == "" || input.FamilyID != "" && !opaque.MatchString(input.FamilyID) || input.IntentID != "" && !opaque.MatchString(input.IntentID) {
		return &Error{Code: CodeBinding}
	}
	ids := []string{}
	err := c.store.update(func(s *durableState) error {
		if input.IntentID != "" {
			in := s.Intents[input.IntentID]
			if in == nil {
				return &Error{Code: CodeBinding}
			}
			in.Fenced = true
			if in.ResultID != "" {
				ids = append(ids, in.ResultID)
			}
		}
		if input.FamilyID != "" {
			if s.Families[input.FamilyID] == nil {
				return &Error{Code: CodeBinding}
			}
			ids = append(ids, input.FamilyID)
		}
		visited := map[string]bool{}
		for index := 0; index < len(ids); index++ {
			id := ids[index]
			if visited[id] {
				continue
			}
			visited[id] = true
			f := s.Families[id]
			if f == nil {
				continue
			}
			if !f.Fenced {
				f.PendingRevoke = randomToken()
			}
			f.Fenced = true
			for _, in := range s.Intents {
				if in.PreviousFamilyID == id || in.ResultID == id {
					in.Fenced = true
					if in.ResultID != "" && !visited[in.ResultID] {
						ids = append(ids, in.ResultID)
					}
				}
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err = c.deliverRevoke(ctx, id); err != nil {
			return &Error{Code: CodeUnavailable, LocallyFenced: true, RevocationPending: true}
		}
	}
	return nil
}
func (c *Client) deliverRevoke(ctx context.Context, id string) error {
	var r familyRecord
	err := c.store.view(func(s *durableState) error {
		f := s.Families[id]
		if f == nil || !f.Fenced {
			return &Error{Code: CodeBinding}
		}
		r = *f
		return nil
	})
	if err != nil || r.PendingRevoke == "" {
		return err
	}
	var result struct {
		Revoked bool `json:"revoked"`
	}
	err = c.call(ctx, "/v2/browser-sessions/revoke-family", map[string]any{"clientId": c.cfg.ClientID, "familyId": r.CentralID, "requestId": r.PendingRevoke}, &result)
	if err != nil {
		return err
	}
	if !result.Revoked {
		return &Error{Code: CodeBinding}
	}
	return c.store.update(func(s *durableState) error {
		f := s.Families[id]
		if f == nil || !f.Fenced || f.PendingRevoke != r.PendingRevoke {
			return &Error{Code: CodeConflict}
		}
		f.PendingRevoke = ""
		return nil
	})
}
