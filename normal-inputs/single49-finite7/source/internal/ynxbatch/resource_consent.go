package ynxbatch

import (
	"bytes"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

// The sole SDK calls this family E5, but its actual existing encodeFields call
// has seven fields, including keyEpoch and issuedHeight. Do not drop either.
const (
	NetworkResourceConsentDomain   = "YNX-NETWORK-RESOURCE-CONSENT/v1"
	NetworkResourceConsentPurpose  = "NETWORK-RESOURCE-CONSENT"
	NetworkResourceOperation       = "resource.public-block-histogram"
	MaxNetworkResourceInputBytes   = 4 << 20
	MaxNetworkResourceScopeBytes   = 49152
	MaxNetworkResourceMessageBytes = 65536
	MaxNetworkResourceMemberBytes  = 262144
)

type NetworkResourceSelector struct {
	InstanceID  string `json:"instanceId"`
	ResourceKey string `json:"resourceKey"`
	SourceID    string `json:"sourceId"`
}
type NetworkResourceIssuer struct {
	CanonicalIssuer      string                  `json:"canonicalIssuer"`
	CurrentSelector      NetworkResourceSelector `json:"currentSelector"`
	KeyEpoch             string                  `json:"keyEpoch"`
	TrustPublisherSource string                  `json:"trustPublisherSource"`
}
type NetworkResourceRequest struct {
	LifecycleRef             string                  `json:"lifecycleRef"`
	OriginalCallerRef        string                  `json:"originalCallerRef"`
	Principal                string                  `json:"principal"`
	PrincipalCurrentSelector NetworkResourceSelector `json:"principalCurrentSelector"`
	PrincipalKeyEpoch        string                  `json:"principalKeyEpoch"`
	RequestID                string                  `json:"requestId"`
}
type NetworkResourceScope struct {
	ConsentOriginal      string                 `json:"consentOriginal"`
	Issuer               NetworkResourceIssuer  `json:"issuer"`
	ManifestOriginal     string                 `json:"manifestOriginal"`
	ProtectedResourceRef string                 `json:"protectedResourceRef"`
	Request              NetworkResourceRequest `json:"request"`
	Version              uint32                 `json:"version"`
}
type NetworkResourceLimits struct {
	CPUMilli       string `json:"cpuMilli"`
	DurationMillis string `json:"durationMillis"`
	EgressBytes    string `json:"egressBytes"`
	MemoryBytes    string `json:"memoryBytes"`
	StorageBytes   string `json:"storageBytes"`
}
type NetworkResourceWork struct {
	ExpiresAt string                `json:"expiresAt"`
	Input     DeploymentV2Bind      `json:"input"`
	Issuer    string                `json:"issuer"`
	Job       string                `json:"job"`
	Kind      string                `json:"kind"`
	Limits    NetworkResourceLimits `json:"limits"`
}
type NetworkResourceConsent struct {
	Allow     bool                  `json:"allow"`
	ExpiresAt string                `json:"expiresAt"`
	Job       string                `json:"job"`
	Limits    NetworkResourceLimits `json:"limits"`
	Manifest  DeploymentV2Bind      `json:"manifest"`
	Nonce     string                `json:"nonce"`
	Principal string                `json:"principal"`
}

// Independent expected public DATA. Full keys and these fields do not establish
// Root provenance, current, registration, Native decision or durable once.
type NetworkResourceConsentBinding struct {
	NetworkID              []byte
	Owner                  string
	KeyEpoch, IssuedHeight string
	PKA, PKB               []byte
}

type NetworkResourceConsentMessage struct {
	Binding                        NetworkResourceConsentBinding
	Scope                          NetworkResourceScope
	Work                           NetworkResourceWork
	Consent                        NetworkResourceConsent
	ScopeOriginal, MessageOriginal []byte
}

var resourceID = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)
var resourceExpiry = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$`)

func resourceDecimal(s string, positive bool) (uint64, error) {
	n, err := strconv.ParseUint(s, 10, 64)
	if err != nil || strconv.FormatUint(n, 10) != s || positive && n == 0 {
		return 0, invalid("resource canonical uint64 decimal")
	}
	return n, nil
}

// All fields reserialized here have closed ASCII grammars. The actual input
// may contain arbitrary valid UTF8 JSON; it is hashed, never reserialized.
func resourceCanonical(v any) []byte {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	if e.Encode(v) != nil {
		return nil
	}
	return bytes.TrimSuffix(b.Bytes(), []byte{'\n'})
}
func resourceDecode(raw []byte, maximum int, out any) error {
	if len(raw) == 0 || len(raw) > maximum || !utf8.Valid(raw) {
		return invalid("resource original bounds or UTF8")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(out) != nil || d.Decode(&struct{}{}) != io.EOF || !bytes.Equal(resourceCanonical(out), raw) {
		return invalid("resource exact canonical original fields")
	}
	return nil
}
func resourceBind(raw []byte) DeploymentV2Bind {
	a, b := sha3.Sum512(raw), sha512.Sum512(raw)
	return DeploymentV2Bind{Bytes: strconv.Itoa(len(raw)), SHA3_512: hex.EncodeToString(a[:]), SHA512: hex.EncodeToString(b[:])}
}
func resourceSelector(s NetworkResourceSelector) bool {
	return resourceID.MatchString(s.InstanceID) && resourceID.MatchString(s.ResourceKey) && resourceID.MatchString(s.SourceID)
}
func resourceExpiration(s string, nowMillis int64) (time.Time, error) {
	if nowMillis < 0 || nowMillis > 9007199254740991 || !resourceExpiry.MatchString(s) {
		return time.Time{}, invalid("resource exact clock or expiry")
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	now := time.UnixMilli(nowMillis)
	if err != nil || !t.After(now) || t.After(now.Add(24*time.Hour)) {
		return time.Time{}, invalid("resource expired or overlong window")
	}
	return t, nil
}
func resourceLimits(l NetworkResourceLimits, inputBytes int) error {
	cpu, e1 := resourceDecimal(l.CPUMilli, true)
	duration, e2 := resourceDecimal(l.DurationMillis, true)
	egress, e3 := resourceDecimal(l.EgressBytes, false)
	memory, e4 := resourceDecimal(l.MemoryBytes, true)
	storage, e5 := resourceDecimal(l.StorageBytes, false)
	if errors.Join(e1, e2, e3, e4, e5) != nil || cpu > 1000 || duration > 5000 || storage != 0 || egress != 0 || memory < uint64(129*65536+2*inputBytes+65536) || memory > 24*1024*1024 {
		return invalid("resource fixed operation limits")
	}
	return nil
}
func resourceBinding(b NetworkResourceConsentBinding) (NetworkResourceConsentBinding, error) {
	if len(b.NetworkID) != 32 || !accountaddress.IsCanonical(b.Owner) || len(b.PKA) != PublicKeyASize || len(b.PKB) != PublicKeyBSize {
		return NetworkResourceConsentBinding{}, invalid("resource independent full public binding")
	}
	if _, err := resourceDecimal(b.KeyEpoch, true); err != nil {
		return NetworkResourceConsentBinding{}, err
	}
	if _, err := resourceDecimal(b.IssuedHeight, false); err != nil {
		return NetworkResourceConsentBinding{}, err
	}
	b.NetworkID, b.PKA, b.PKB = clone(b.NetworkID), clone(b.PKA), clone(b.PKB)
	return b, nil
}

// BuildNetworkResourceConsentMessage validates the original complete input and
// exact SDK scope/work/consent. Allow=false remains a signable DENY statement;
// an execution owner must separately require actual approved allow=true.
func BuildNetworkResourceConsentMessage(scopeOriginal, inputOriginal []byte, nowMillis int64, binding NetworkResourceConsentBinding) (NetworkResourceConsentMessage, error) {
	var out NetworkResourceConsentMessage
	b, err := resourceBinding(binding)
	if err != nil {
		return out, err
	}
	if len(inputOriginal) == 0 || len(inputOriginal) > MaxNetworkResourceInputBytes || !utf8.Valid(inputOriginal) || !json.Valid(inputOriginal) || !bytes.HasPrefix(bytes.TrimSpace(inputOriginal), []byte{'{'}) {
		return out, invalid("resource complete original object input")
	}
	var s NetworkResourceScope
	if err := resourceDecode(scopeOriginal, MaxNetworkResourceScopeBytes, &s); err != nil {
		return out, err
	}
	if s.Version != 1 || !resourceID.MatchString(s.ProtectedResourceRef) || !resourceID.MatchString(s.Issuer.CanonicalIssuer) || !resourceID.MatchString(s.Issuer.TrustPublisherSource) || !resourceSelector(s.Issuer.CurrentSelector) || !resourceSelector(s.Request.PrincipalCurrentSelector) {
		return out, invalid("resource fixed scope and selectors")
	}
	if _, err := resourceDecimal(s.Issuer.KeyEpoch, true); err != nil {
		return out, err
	}
	if s.Request.PrincipalKeyEpoch != b.KeyEpoch {
		return out, invalid("resource principal epoch binding")
	}
	for _, id := range []string{s.Request.Principal, s.Request.LifecycleRef, s.Request.OriginalCallerRef, s.Request.RequestID} {
		if !resourceID.MatchString(id) {
			return out, invalid("resource request identity")
		}
	}
	var w NetworkResourceWork
	if err := resourceDecode([]byte(s.ManifestOriginal), 16384, &w); err != nil {
		return out, err
	}
	if w.Kind != "public_block_histogram" || !resourceID.MatchString(w.Job) || !resourceID.MatchString(w.Issuer) || w.Issuer != s.Issuer.CanonicalIssuer || w.Input != resourceBind(inputOriginal) {
		return out, invalid("resource original work or input binding")
	}
	if err := resourceLimits(w.Limits, len(inputOriginal)); err != nil {
		return out, err
	}
	workExpiry, err := resourceExpiration(w.ExpiresAt, nowMillis)
	if err != nil {
		return out, err
	}
	var c NetworkResourceConsent
	if err := resourceDecode([]byte(s.ConsentOriginal), 16384, &c); err != nil {
		return out, err
	}
	if !resourceID.MatchString(c.Principal) || !resourceID.MatchString(c.Nonce) || c.Principal != s.Request.Principal || c.Job != w.Job || c.Manifest != resourceBind([]byte(s.ManifestOriginal)) || c.Limits != w.Limits {
		return out, invalid("resource original consent binding")
	}
	consentExpiry, err := resourceExpiration(c.ExpiresAt, nowMillis)
	if err != nil || consentExpiry.After(workExpiry) {
		return out, invalid("resource consent expiry")
	}
	body := resourceCanonical(struct {
		Purpose string               `json:"purpose"`
		Scope   NetworkResourceScope `json:"scope"`
		Version uint32               `json:"version"`
	}{NetworkResourceConsentPurpose, s, 1})
	message, err := EncodeFields([]byte(NetworkResourceConsentDomain), U32(1), b.NetworkID, []byte(b.Owner), []byte(b.KeyEpoch), []byte(b.IssuedHeight), body)
	if err != nil || len(message) > MaxNetworkResourceMessageBytes {
		return out, invalid("resource consent message bound")
	}
	return NetworkResourceConsentMessage{Binding: b, Scope: s, Work: w, Consent: c, ScopeOriginal: clone(scopeOriginal), MessageOriginal: message}, nil
}

func InspectNetworkResourceConsentMessage(message, inputOriginal []byte, nowMillis int64, b NetworkResourceConsentBinding) (NetworkResourceConsentMessage, error) {
	var out NetworkResourceConsentMessage
	f, err := fields(message, 7, MaxNetworkResourceMessageBytes, len(NetworkResourceConsentDomain), 4, 32, 42, 20, 20, MaxNetworkResourceScopeBytes+128)
	if err != nil {
		return out, err
	}
	if string(f[0]) != NetworkResourceConsentDomain || !bytes.Equal(f[1], U32(1)) || !bytes.Equal(f[2], b.NetworkID) || string(f[3]) != b.Owner || string(f[4]) != b.KeyEpoch || string(f[5]) != b.IssuedHeight {
		return out, invalid("resource exact signed frame binding")
	}
	var body struct {
		Purpose string               `json:"purpose"`
		Scope   NetworkResourceScope `json:"scope"`
		Version uint32               `json:"version"`
	}
	if err := resourceDecode(f[6], MaxNetworkResourceScopeBytes+128, &body); err != nil {
		return out, err
	}
	if body.Purpose != NetworkResourceConsentPurpose || body.Version != 1 {
		return out, invalid("resource consent body domain")
	}
	out, err = BuildNetworkResourceConsentMessage(resourceCanonical(body.Scope), inputOriginal, nowMillis, b)
	if err != nil {
		return NetworkResourceConsentMessage{}, err
	}
	if !bytes.Equal(out.MessageOriginal, message) {
		return NetworkResourceConsentMessage{}, invalid("resource noncanonical exact frame")
	}
	return out, nil
}

// InspectNetworkResourceConsentMember verifies mathematics only. Independent
// registered/current policy and Source/Native/once gates remain separate.
func InspectNetworkResourceConsentMember(member, scopeOriginal, inputOriginal []byte, nowMillis int64, b NetworkResourceConsentBinding) (NetworkResourceConsentMessage, error) {
	out, err := BuildNetworkResourceConsentMessage(scopeOriginal, inputOriginal, nowMillis, b)
	if err != nil {
		return NetworkResourceConsentMessage{}, err
	}
	if len(member) == 0 || len(member) > MaxNetworkResourceMemberBytes {
		return NetworkResourceConsentMessage{}, invalid("resource member bound")
	}
	m, err := DecodeMember(member)
	if err != nil {
		return NetworkResourceConsentMessage{}, err
	}
	c := m.Certificate
	if c.N != 1 || m.Index != 0 || len(m.PathA) != 0 || len(m.PathB) != 0 || c.Purpose != NetworkResourceConsentPurpose || c.Owner != b.Owner || !bytes.Equal(c.ChainID, b.NetworkID) || !bytes.Equal(c.PKA, b.PKA) || !bytes.Equal(c.PKB, b.PKB) || !bytes.Equal(m.Message, out.MessageOriginal) {
		return NetworkResourceConsentMessage{}, invalid("resource exact N1 full pair member")
	}
	v, err := NewVerifier(VerifierOptions{ChainID: b.NetworkID, Purpose: NetworkResourceConsentPurpose, CacheEntries: 0, ResolveTrustedOwner: func(r TrustRequest) (Registration, error) {
		if r.Height != 0 || r.Owner != b.Owner || r.Purpose != NetworkResourceConsentPurpose || !bytes.Equal(r.ChainID, b.NetworkID) {
			return Registration{}, ErrUntrusted
		}
		return Registration{Enabled: true, AlgorithmVersion: Version, Owner: b.Owner, Purpose: NetworkResourceConsentPurpose, ChainID: clone(b.NetworkID), PKA: clone(b.PKA), PKB: clone(b.PKB), PolicyRevision: "resource-consent-data-only"}, nil
	}})
	if err != nil {
		return NetworkResourceConsentMessage{}, err
	}
	defer v.Clear()
	if err = v.VerifyOne(member, 0); err != nil {
		return NetworkResourceConsentMessage{}, err
	}
	return out, nil
}

// NetworkResourceConsentOutcome must be adopted before interpreting err. A
// nonempty original is retained even if a late postcondition fails. Cleanup
// means this call's Batch only, not a borrowed key or its protected parent.
type NetworkResourceConsentOutcome struct {
	MemberOriginal       []byte
	SignatureVerified    bool
	BatchCleanupComplete bool
}

// SignNetworkResourceConsentDATA is a fixed mathematical backend for an
// original owner holding an existing opaque key. It is NOT a protected lease
// factory, durable once, permission, current selector or production entry.
// It does not take key bytes, providers, callbacks, domains or randomness.
func SignNetworkResourceConsentDATA(key *PrivateKey, scopeOriginal, inputOriginal []byte, nowMillis int64, b NetworkResourceConsentBinding) (out NetworkResourceConsentOutcome, err error) {
	plan, err := BuildNetworkResourceConsentMessage(scopeOriginal, inputOriginal, nowMillis, b)
	if err != nil {
		return out, err
	}
	if key == nil || key.state == nil {
		return out, invalid("resource unknown key handle")
	}
	key.state.mu.Lock()
	match := key.state.a != nil && key.state.b != nil && bytes.Equal(key.state.public.PKA, b.PKA) && bytes.Equal(key.state.public.PKB, b.PKB)
	key.state.mu.Unlock()
	if !match {
		return out, invalid("resource key differs from independent full pair")
	}
	var batch *Batch
	defer func() {
		if recover() != nil {
			err = errors.New("resource signing failed; retain original outcome")
		}
		batch.Discard()
		out.BatchCleanupComplete = true
	}()
	batch, err = BatchSign(key, Metadata{ChainID: plan.Binding.NetworkID, Owner: plan.Binding.Owner, Purpose: NetworkResourceConsentPurpose}, [][]byte{plan.MessageOriginal}, SignOptions{Optimized: true})
	if err != nil {
		return out, err
	}
	m, err := Extract(batch, 0)
	if err != nil {
		return out, err
	}
	out.MemberOriginal, err = EncodeMember(m)
	if err != nil {
		return out, err
	}
	_, err = InspectNetworkResourceConsentMember(out.MemberOriginal, plan.ScopeOriginal, inputOriginal, nowMillis, plan.Binding)
	out.SignatureVerified = err == nil
	return out, err
}
