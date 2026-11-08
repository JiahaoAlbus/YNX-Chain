// Package socialfreshjointprofile is reference DATA preparation/consistency only.
// It never selects a protected owner, signs, verifies Source crypto or grants.
package socialfreshjointprofile

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
)

const Purpose = "YNX/SOCIAL/DEVICE-SESSION-PRINCIPAL/V1"
const BodyMaxBytes = 32768

var ErrBinding = errors.New("SOCIAL_FRESH_JOINT_PROFILE_BINDING")
var ErrNotSupplied = errors.New("SOCIAL_FRESH_JOINT_PROFILE_ISSUER_NOT_SUPPLIED")

type ScopeDATA struct {
	Source                   string `json:"source"`
	Store                    string `json:"store"`
	Schema                   string `json:"schema"`
	Inode                    string `json:"inode"`
	Restore                  string `json:"restore"`
	SourceGeneration         uint64 `json:"sourceGeneration"`
	NativeRestoreIncarnation uint64 `json:"nativeRestoreIncarnation"`
}
type Expected17DATA struct {
	NetworkID          string  `json:"networkId"`
	CanonicalOwner     string  `json:"canonicalOwner"`
	Account            string  `json:"account"`
	SessionBinding     string  `json:"sessionBinding"`
	ProductID          string  `json:"productId"`
	ClientID           string  `json:"clientId"`
	Platform           string  `json:"platform"`
	ApplicationID      string  `json:"applicationId"`
	BundleID           *string `json:"bundleId"`
	PackageID          *string `json:"packageId"`
	Origin             string  `json:"origin"`
	Callback           string  `json:"callback"`
	DeviceID           string  `json:"deviceId"`
	Generation         string  `json:"generation"`
	RegistrationID     string  `json:"registrationId"`
	Revision           string  `json:"revision"`
	RegistrationDigest string  `json:"registrationDigest"`
}

// Exact existing signed body16 field order and names. Never add authority flags.
type BodyDATA struct {
	Version                     int            `json:"version"`
	Purpose                     string         `json:"purpose"`
	Scope                       ScopeDATA      `json:"scope"`
	Realm                       string         `json:"realm"`
	Client                      string         `json:"client"`
	Network                     string         `json:"network"`
	Identity                    string         `json:"identity"`
	Device                      string         `json:"device"`
	ClassicPublic               string         `json:"classicPublic"`
	PQPublic                    string         `json:"pqPublic"`
	V4Expected                  Expected17DATA `json:"v4Expected"`
	SourceHistoryOriginalSHA256 string         `json:"sourceHistoryOriginalSHA256"`
	IssuerEpoch                 uint64         `json:"issuerEpoch"`
	AnchorEpoch                 uint64         `json:"anchorEpoch"`
	IssuedMS                    int64          `json:"issuedMS"`
	ExpiresMS                   int64          `json:"expiresMS"`
}
type Policy10DATA struct {
	Version                                             int
	Purpose, Role, Realm, Client, Network, HeaderSHA256 string
	NotBeforeMS, ExpiresMS, MaxLifetimeMS               int64
}

// Original inputs must be copied from the same independently verified held
// prepared Source. Public DATA values below cannot mint that private owner.
type CapturedDATA struct {
	HistoryEnvelopeOriginal, IssuerCredentialOriginal, AnchorCredentialOriginal, RegistrationOriginal []byte
	Scope                                                                                             ScopeDATA
	IssuerEpoch, AnchorEpoch                                                                          uint64
	HistoryIssuedMS, HistoryExpiresMS, CapturedDeadlineMS                                             int64
}
type RegisteredBindingDATA struct {
	Realm, Client, Network, Identity, Device, HeaderSHA256 string
	ClassicPublic, PQPublic                                []byte
	Expected                                               Expected17DATA
}
type WindowDATA struct{ IssuedMS, ExpiresMS, AtMS int64 }
type PlanDATA struct {
	BodyOriginal                                    []byte
	HistoryOriginalSHA256                           string
	RootAdmission, SourceAdmission, NativeAdmission bool
}

func ascii(s string, n int) bool {
	if len(s) < 1 || len(s) > n {
		return false
	}
	for _, b := range []byte(s) {
		if b < 33 || b > 126 {
			return false
		}
	}
	return true
}
func digest(s string) bool {
	b, e := hex.DecodeString(s)
	return e == nil && len(b) == 32 && hex.EncodeToString(b) == s
}
func timeOK(n int64) bool { return n > 0 && n <= 9007199254740991 }
func policy(p Policy10DATA, role string) bool {
	return p.Version == 1 && p.Purpose == Purpose && p.Role == role && ascii(p.Realm, 128) && ascii(p.Client, 128) && ascii(p.Network, 128) && digest(p.HeaderSHA256) && timeOK(p.NotBeforeMS) && timeOK(p.ExpiresMS) && p.ExpiresMS > p.NotBeforeMS && p.MaxLifetimeMS > 0 && p.MaxLifetimeMS <= 30000
}
func expected(v Expected17DATA) bool {
	owner, e := hex.DecodeString(v.CanonicalOwner[min(2, len(v.CanonicalOwner)):])
	if e != nil || len(v.CanonicalOwner) != 42 || v.CanonicalOwner[:2] != "0x" || len(owner) != 20 || "0x"+hex.EncodeToString(owner) != v.CanonicalOwner || !digest(v.NetworkID) || !digest(v.RegistrationDigest) || v.ProductID != "social" {
		return false
	}
	for _, s := range []string{v.Account, v.SessionBinding, v.ClientID, v.Platform, v.ApplicationID, v.Origin, v.Callback, v.DeviceID, v.RegistrationID} {
		if !ascii(s, 2048) {
			return false
		}
	}
	for _, s := range []string{v.Generation, v.Revision} {
		n, e := strconv.ParseUint(s, 10, 64)
		if e != nil || n == 0 || strconv.FormatUint(n, 10) != s {
			return false
		}
	}
	for _, s := range []*string{v.BundleID, v.PackageID} {
		if s != nil && !ascii(*s, 2048) {
			return false
		}
	}
	return true
}
func validate(c CapturedDATA, b RegisteredBindingDATA, i, a *Policy10DATA, w WindowDATA) error {
	if i == nil || a == nil {
		return ErrNotSupplied
	}
	if !policy(*i, "issuer") || !policy(*a, "anchor") {
		return ErrBinding
	}
	x, y := *i, *a
	x.Role = ""
	y.Role = ""
	if x != y || i.Realm != b.Realm || i.Client != b.Client || i.Network != b.Network || i.HeaderSHA256 != b.HeaderSHA256 {
		return ErrBinding
	}
	for _, v := range [][]byte{c.HistoryEnvelopeOriginal, c.IssuerCredentialOriginal, c.AnchorCredentialOriginal, c.RegistrationOriginal} {
		if len(v) < 1 || len(v) > 65536 {
			return ErrBinding
		}
	}
	for _, s := range []string{c.Scope.Source, c.Scope.Store, c.Scope.Schema, c.Scope.Inode, c.Scope.Restore} {
		if !ascii(s, 2048) {
			return ErrBinding
		}
	}
	if !ascii(b.Identity, 128) || !ascii(b.Device, 128) || !expected(b.Expected) || len(b.ClassicPublic) != 33 || b.ClassicPublic[0] != 5 || len(b.PQPublic) != 2592 {
		return ErrBinding
	}
	if !timeOK(c.HistoryIssuedMS) || !timeOK(c.HistoryExpiresMS) || !timeOK(c.CapturedDeadlineMS) || !timeOK(w.IssuedMS) || !timeOK(w.ExpiresMS) || !timeOK(w.AtMS) || w.IssuedMS < c.HistoryIssuedMS || w.ExpiresMS > c.HistoryExpiresMS || w.ExpiresMS > c.CapturedDeadlineMS || w.IssuedMS < i.NotBeforeMS || w.ExpiresMS > i.ExpiresMS || w.ExpiresMS <= w.IssuedMS || w.ExpiresMS-w.IssuedMS > i.MaxLifetimeMS || w.AtMS < w.IssuedMS || w.AtMS >= w.ExpiresMS {
		return ErrBinding
	}
	return nil
}
func cloneExpected(v Expected17DATA) Expected17DATA {
	if v.BundleID != nil {
		s := *v.BundleID
		v.BundleID = &s
	}
	if v.PackageID != nil {
		s := *v.PackageID
		v.PackageID = &s
	}
	return v
}
func PrepareBodyDATA(c CapturedDATA, b RegisteredBindingDATA, i, a *Policy10DATA, w WindowDATA) (PlanDATA, error) {
	if e := validate(c, b, i, a, w); e != nil {
		return PlanDATA{}, e
	}
	sum := sha256.Sum256(c.HistoryEnvelopeOriginal)
	h := hex.EncodeToString(sum[:])
	body := BodyDATA{1, Purpose, c.Scope, b.Realm, b.Client, b.Network, b.Identity, b.Device, base64.RawURLEncoding.EncodeToString(b.ClassicPublic), base64.RawURLEncoding.EncodeToString(b.PQPublic), cloneExpected(b.Expected), h, c.IssuerEpoch, c.AnchorEpoch, w.IssuedMS, w.ExpiresMS}
	raw, e := json.Marshal(body)
	if e != nil || len(raw) > BodyMaxBytes {
		return PlanDATA{}, ErrBinding
	}
	return PlanDATA{BodyOriginal: raw, HistoryOriginalSHA256: h}, nil
}

// Canonical byte consistency with SAME fresh capture and selected DATA. Actual
// Auth verifier must still verify both registered envelopes/DEVICE/current.
func InspectBodyOriginalDATA(raw []byte, c CapturedDATA, b RegisteredBindingDATA, i, a *Policy10DATA, w WindowDATA) (PlanDATA, error) {
	if len(raw) < 1 || len(raw) > BodyMaxBytes {
		return PlanDATA{}, ErrBinding
	}
	var body BodyDATA
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&body) != nil {
		return PlanDATA{}, ErrBinding
	}
	canonical, e := json.Marshal(body)
	if e != nil || !bytes.Equal(canonical, raw) {
		return PlanDATA{}, ErrBinding
	}
	plan, e := PrepareBodyDATA(c, b, i, a, w)
	if e != nil {
		return plan, e
	}
	if !bytes.Equal(raw, plan.BodyOriginal) {
		return PlanDATA{}, ErrBinding
	}
	return plan, nil
}
