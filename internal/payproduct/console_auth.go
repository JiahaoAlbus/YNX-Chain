package payproduct

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

const (
	MerchantProductID = "pay-merchant"
	MerchantClientID  = "ynx-merchant-console-v1"
	MerchantBundleID  = "com.ynxweb4.merchant-console"
	MerchantCallback  = "https://pay.ynxweb4.com/merchant/wallet-auth/callback"
	gatewayDomain     = "YNX_PRODUCT_GATEWAY_ASSERTION_V1"
)

var merchantConsoleScopes = []string{"account:read", "merchant:session:create"}

type merchantGatewayAssertion struct {
	Account, SessionID, DeviceID, ProductID, ClientID, BundleID, Callback, ChainID string
	Scopes                                                                         []string
	RequestDigest, Nonce                                                           string
	IssuedAt, ExpiresAt                                                            time.Time
}

type MerchantPrincipal struct {
	Merchant Merchant `json:"merchant"`
	Account  string   `json:"account"`
	Role     string   `json:"role"`
	Session  string   `json:"sessionId"`
}

type MerchantSessionResult struct {
	SessionID string    `json:"sessionId"`
	Token     string    `json:"token"`
	Merchant  Merchant  `json:"merchant"`
	Account   string    `json:"account"`
	Role      string    `json:"role"`
	ExpiresAt time.Time `json:"expiresAt"`
}

var merchantRolePermissions = map[string]map[string]bool{
	"owner":     {"read": true, "invoice": true, "reconcile": true, "case": true, "webhook": true, "ai-run": true, "ai-review": true, "members": true},
	"finance":   {"read": true, "invoice": true, "reconcile": true, "case": true, "ai-run": true, "ai-review": true},
	"developer": {"read": true, "webhook": true},
	"support":   {"read": true, "case": true, "ai-run": true},
	"viewer":    {"read": true},
}

func (s *Service) CompleteMerchantSession(r *http.Request, body []byte, merchantID string) (MerchantSessionResult, error) {
	a, err := s.verifyMerchantGateway(r, body)
	if err != nil {
		return MerchantSessionResult{}, err
	}
	var merchant Merchant
	var member MerchantMember
	err = s.store.View(func(data Snapshot) error {
		var ok bool
		merchant, ok = data.Merchants[merchantID]
		if !ok || merchant.Status != "active" {
			return errors.New("merchant is not active")
		}
		member, ok = data.MerchantMembers[merchantID+":"+a.Account]
		if !ok || member.Status != "active" || !validMerchantRole(member.Role) {
			return errors.New("Wallet account is not an active merchant member")
		}
		return nil
	})
	if err != nil {
		return MerchantSessionResult{}, err
	}
	now := s.now().UTC()
	token := randomToken(32)
	session := MerchantConsoleSession{ID: "mcs_" + randomToken(16), MerchantID: merchant.ID, Account: a.Account, Role: member.Role, TokenHash: hashString(token), ExpiresAt: now.Add(15 * time.Minute), CreatedAt: now}
	err = s.store.Update(func(data *Snapshot) error {
		data.ConsoleSessions[session.ID] = session
		for id, current := range data.ConsoleSessions {
			if !now.Before(current.ExpiresAt) {
				delete(data.ConsoleSessions, id)
			}
		}
		appendAudit(data, merchant.ID, a.Account, "merchant.session.create", session.ID, "committed", "role="+member.Role, now)
		return nil
	})
	if err != nil {
		return MerchantSessionResult{}, err
	}
	return MerchantSessionResult{SessionID: session.ID, Token: session.ID + "." + token, Merchant: publicMerchant(merchant), Account: a.Account, Role: member.Role, ExpiresAt: session.ExpiresAt}, nil
}

func (s *Service) AuthenticateMerchantSession(header string) (MerchantPrincipal, error) {
	raw := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(header), "Bearer "))
	parts := strings.Split(raw, ".")
	if len(parts) != 2 || !strings.HasPrefix(parts[0], "mcs_") {
		return MerchantPrincipal{}, errors.New("active Wallet/Gateway merchant session required")
	}
	var session MerchantConsoleSession
	var merchant Merchant
	err := s.store.View(func(data Snapshot) error {
		var ok bool
		session, ok = data.ConsoleSessions[parts[0]]
		if !ok || session.RevokedAt != nil || !s.now().UTC().Before(session.ExpiresAt) || !hmac.Equal([]byte(session.TokenHash), []byte(hashString(parts[1]))) {
			return errors.New("merchant session is invalid or expired")
		}
		member, ok := data.MerchantMembers[session.MerchantID+":"+session.Account]
		if !ok || member.Status != "active" || member.Role != session.Role {
			return errors.New("merchant membership changed; sign in again")
		}
		merchant, ok = data.Merchants[session.MerchantID]
		if !ok || merchant.Status != "active" {
			return errors.New("merchant is not active")
		}
		return nil
	})
	if err != nil {
		return MerchantPrincipal{}, err
	}
	return MerchantPrincipal{Merchant: merchant, Account: session.Account, Role: session.Role, Session: session.ID}, nil
}

func (s *Service) UpsertMerchantMember(actor MerchantPrincipal, account, role string) (MerchantMember, error) {
	if actor.Role != "owner" {
		return MerchantMember{}, errors.New("owner role required")
	}
	account, err := nativewallet.NormalizeNativeAddress(account)
	if err != nil || !validMerchantRole(role) {
		return MerchantMember{}, errors.New("canonical Wallet account and valid merchant role required")
	}
	now := s.now().UTC()
	member := MerchantMember{ID: "mem_" + hashString(actor.Merchant.ID, account)[:20], MerchantID: actor.Merchant.ID, Account: account, Role: role, Status: "active", CreatedAt: now, UpdatedAt: now}
	err = s.store.Update(func(data *Snapshot) error {
		key := actor.Merchant.ID + ":" + account
		if old, ok := data.MerchantMembers[key]; ok {
			if old.Role == "owner" && role != "owner" && old.Status == "active" {
				owners := 0
				for _, existing := range data.MerchantMembers {
					if existing.MerchantID == actor.Merchant.ID && existing.Status == "active" && existing.Role == "owner" {
						owners++
					}
				}
				if owners <= 1 {
					return errors.New("merchant must retain at least one active owner")
				}
			}
			member.ID, member.CreatedAt = old.ID, old.CreatedAt
		}
		data.MerchantMembers[key] = member
		appendAudit(data, actor.Merchant.ID, actor.Account, "merchant.member.upsert", member.ID, "committed", "role="+role, now)
		return nil
	})
	return member, err
}

func validMerchantRole(role string) bool {
	switch role {
	case "owner", "finance", "developer", "support", "viewer":
		return true
	default:
		return false
	}
}

func roleAllows(role, permission string) bool {
	return merchantRolePermissions[role][permission]
}

func (s *Service) verifyMerchantGateway(r *http.Request, body []byte) (merchantGatewayAssertion, error) {
	a := merchantGatewayAssertion{Account: strings.TrimSpace(r.Header.Get("X-YNX-Account")), SessionID: strings.TrimSpace(r.Header.Get("X-YNX-Session-ID")), DeviceID: strings.TrimSpace(r.Header.Get("X-YNX-Device-ID")), ProductID: strings.TrimSpace(r.Header.Get("X-YNX-Product")), ClientID: strings.TrimSpace(r.Header.Get("X-YNX-Client")), BundleID: strings.TrimSpace(r.Header.Get("X-YNX-Bundle")), Callback: strings.TrimSpace(r.Header.Get("X-YNX-Callback")), ChainID: strings.TrimSpace(r.Header.Get("X-YNX-Chain")), RequestDigest: strings.ToLower(strings.TrimSpace(r.Header.Get("X-YNX-Request-Digest"))), Nonce: strings.TrimSpace(r.Header.Get("X-YNX-Nonce"))}
	a.Scopes = strings.Fields(r.Header.Get("X-YNX-Scopes"))
	sort.Strings(a.Scopes)
	var err error
	a.IssuedAt, err = time.Parse(time.RFC3339Nano, r.Header.Get("X-YNX-Issued-At"))
	if err != nil {
		return merchantGatewayAssertion{}, errors.New("canonical Gateway assertion required")
	}
	a.ExpiresAt, err = time.Parse(time.RFC3339Nano, r.Header.Get("X-YNX-Expires-At"))
	if err != nil {
		return merchantGatewayAssertion{}, errors.New("canonical Gateway assertion required")
	}
	account, accountErr := nativewallet.NormalizeNativeAddress(a.Account)
	now := s.now().UTC()
	if accountErr != nil || !identifierRE.MatchString(a.SessionID) || !identifierRE.MatchString(a.DeviceID) || !identifierRE.MatchString(a.Nonce) || a.ProductID != MerchantProductID || a.ClientID != MerchantClientID || a.BundleID != MerchantBundleID || a.Callback != MerchantCallback || a.ChainID != ChainID || strings.Join(a.Scopes, "\n") != strings.Join(merchantConsoleScopes, "\n") || len(a.RequestDigest) != 64 || !now.Before(a.ExpiresAt) || a.ExpiresAt.Sub(a.IssuedAt) > 5*time.Minute || now.Before(a.IssuedAt.Add(-30*time.Second)) {
		return merchantGatewayAssertion{}, errors.New("canonical Gateway assertion required")
	}
	a.Account = account
	bodyHash := sha256.Sum256(body)
	material := strings.Join([]string{gatewayDomain, r.Method, r.URL.EscapedPath(), hex.EncodeToString(bodyHash[:]), a.Account, a.SessionID, a.DeviceID, a.ProductID, a.ClientID, a.BundleID, a.Callback, a.ChainID, strings.Join(a.Scopes, " "), a.RequestDigest, a.IssuedAt.UTC().Format(time.RFC3339Nano), a.ExpiresAt.UTC().Format(time.RFC3339Nano), a.Nonce}, "\n")
	want := hmacHex(s.gatewayKey, []byte(material))
	if !hmac.Equal([]byte(strings.ToLower(strings.TrimSpace(r.Header.Get("X-YNX-Gateway-Signature")))), []byte(want)) {
		return merchantGatewayAssertion{}, errors.New("canonical Gateway assertion required")
	}
	err = s.store.Update(func(data *Snapshot) error {
		for nonce, expiry := range data.GatewaySeen {
			if !now.Before(expiry) {
				delete(data.GatewaySeen, nonce)
			}
		}
		if _, ok := data.GatewaySeen[a.Nonce]; ok {
			return errors.New("Gateway assertion replay rejected")
		}
		data.GatewaySeen[a.Nonce] = a.ExpiresAt
		return nil
	})
	return a, err
}
