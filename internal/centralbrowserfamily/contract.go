// Package centralbrowserfamily retains finite identity credentials on the product backend.
package centralbrowserfamily

import (
	"context"
	"net/http"
	"time"
)

type Identity struct {
	Subject    string    `json:"subject"`
	Account    string    `json:"account"`
	Generation int64     `json:"generation"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

// FamilyID is a local opaque reference, never a Central refresh handle.
// GrantToken must remain on the backend and must not be serialized into a cookie.
type Grant struct {
	FamilyID, GrantToken                        string
	Identity                                    Identity
	Audience                                    string
	Scopes                                      []string
	ExpiresAt, AbsoluteExpiresAt, IdleExpiresAt time.Time
	ApprovedProfile, ApprovedClientsDigest      string
}

// Prepare persists a login intent before redirect, using the existing sealed
// pending container. PreviousFamilyID links a replacement to its logout fence.
type PrepareInput struct{ State, PreviousFamilyID string }
type PKCEInput struct{ Code, State, CodeVerifier, IntentID string }

// IntentID is supplied from the server-verified pending container on logout.
type LogoutInput struct{ FamilyID, IntentID string }
type Backend interface {
	Prepare(context.Context, PrepareInput) (string, error)
	Redeem(context.Context, PKCEInput) (Grant, error)
	Resolve(context.Context, string) (Grant, error)
	Activity(context.Context, string, string, time.Time) error
	Logout(context.Context, LogoutInput) error
}

type Config struct {
	Issuer, ClientID, Origin, RedirectURI, Audience, KeyID string
	PrivateKeyPath, SealKeyPath, StorePath                 string
	HTTPClient                                             *http.Client
	Now                                                    func() time.Time
}

const (
	CodeConfiguration = "SSO_FAMILY_CONFIG_INVALID"
	CodeUnavailable   = "SSO_FAMILY_UNAVAILABLE"
	CodeLoginRequired = "SSO_LOGIN_REQUIRED"
	CodeFenced        = "SSO_LOCAL_LOGOUT"
	CodeConflict      = "SSO_FAMILY_CONFLICT"
	CodeBinding       = "SSO_FAMILY_BINDING_MISMATCH"
	CodeActivity      = "SSO_ACTIVITY_INVALID"
)

// A locally fenced record remains inaccessible even if remote revocation fails.
type Error struct {
	Code                             string
	LocallyFenced, RevocationPending bool
}

func (e *Error) Error() string { return e.Code }
