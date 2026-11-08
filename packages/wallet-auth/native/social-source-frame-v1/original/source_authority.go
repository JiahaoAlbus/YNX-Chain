package kernel

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"
)

var (
	errSourceRegistrationRequired = errors.New("SOCIAL_SOURCE_REGISTRATION_REQUIRED")
	errSourceProofInvalid         = errors.New("SOCIAL_SOURCE_PROOF_INVALID")
	errSourceHistoryRequired      = errors.New("SOCIAL_SOURCE_CURRENT_HISTORY_REQUIRED")
	errSourceVerifierUnavailable  = errors.New("SOCIAL_SOURCE_VERIFIER_UNAVAILABLE")
)

const sourceProofLimit = 32768

// Source generation and the native restore number are independently signed
// facts, NOT conversions of device generation or the opaque Restore label.
type sourceScope struct {
	Source                   string `json:"source"`
	Store                    string `json:"store"`
	Schema                   string `json:"schema"`
	Inode                    string `json:"inode"`
	Restore                  string `json:"restore"`
	SourceGeneration         uint64 `json:"sourceGeneration"`
	NativeRestoreIncarnation uint64 `json:"nativeRestoreIncarnation"`
}

type sourcePair struct {
	Classic string `json:"classic"`
	PQ      string `json:"pq"`
}

type sourceEnvelope struct {
	Version   int        `json:"version"`
	Role      string     `json:"role"`
	Body      string     `json:"body"`
	Signature sourcePair `json:"signature"`
}

type sourceCredential struct {
	DeviceRevocation *sourceDeviceRevocationPolicy `json:"deviceRevocation,omitempty"`
	DeviceRevocationSigning *sourceDeviceRevocationSigningPolicy `json:"deviceRevocationSigning,omitempty"`
	DeviceDirectoryRead *sourceDeviceDirectoryReadPolicy `json:"deviceDirectoryRead,omitempty"`
	DeviceSessionPrincipal *sourceDeviceSessionPrincipalPolicy `json:"deviceSessionPrincipal,omitempty"`
	NativeCoreRuntime *nativeCoreRuntimeDelegationWire   `json:"nativeCoreRuntime,omitempty"`
	Issuance          *sourceIssuancePolicy              `json:"issuance,omitempty"`
	Version           int                                `json:"version"`
	Bootstrap         string                             `json:"bootstrap"`
	Authority         string                             `json:"authority"`
	Role              string                             `json:"role"`
	Custodian         string                             `json:"custodian"`
	Epoch             uint64                             `json:"epoch"`
	Scope             sourceScope                        `json:"scope"`
	Public            sourcePair                         `json:"public"`
	HistoryEndpoint   string                             `json:"historyEndpoint"`
	FirstEnrollment   *sourceFirstEnrollmentPolicy       `json:"firstEnrollment,omitempty"`
	FirstPrepared     *sourceFirstPreparedIssuancePolicy `json:"firstPrepared,omitempty"`
}

type sourceRegistration struct {
	DirectoryCheckpoint *sourceEnvelope `json:"directoryCheckpoint,omitempty"`
	Version             int             `json:"version"`
	Issuer              sourceEnvelope  `json:"issuer"`
	Anchor              sourceEnvelope  `json:"anchor"`
}

// A source-owned release policy admits both the enrollment root and the exact
// public verification implementation. A caller/configuration supplies neither.
type sourceBootstrapProfile struct {
	Public          sourcePair
	IssuerCustodian string
	AnchorCustodian string
	Verifier        sourceVerifierImage
	// Exact PUBLIC signed RootReleaseV4 chosen by the source-owned release
	// generator. Empty means unavailable; request/config/ENV cannot opt in.
	NativeCoreReleaseOriginal string
}

type sourceHistoryBody struct {
	DirectoryCheckpoint *sourceDirectoryCheckpoint `json:"directoryCheckpoint,omitempty"`
	Version             int                        `json:"version"`
	Authority           string                     `json:"authority"`
	Epoch               uint64                     `json:"epoch"`
	Scope               sourceScope                `json:"scope"`
	Nonce               string                     `json:"nonce"`
	Head                string                     `json:"head"`
	CatalogDigest       string                     `json:"catalogDigest"`
	Records             uint64                     `json:"records"`
	IssuedMS            int64                      `json:"issuedMS"`
	ExpiresMS           int64                      `json:"expiresMS"`
}

type sourceRecordBody struct {
	Version        int                      `json:"version"`
	Scope          sourceScope              `json:"scope"`
	Kind           string                   `json:"kind"`
	Binding        authorityRegistryBinding `json:"binding"`
	RevokedThrough uint64                   `json:"revokedThrough"`
}

type sourceRecordAnchor struct {
	Version              int         `json:"version"`
	Scope                sourceScope `json:"scope"`
	IssuerEnvelopeDigest string      `json:"issuerEnvelopeDigest"`
	Sequence             uint64      `json:"sequence"`
	Disposition          string      `json:"disposition"`
}

type sourceRecordProof struct {
	Version int            `json:"version"`
	Issuer  sourceEnvelope `json:"issuer"`
	Anchor  sourceEnvelope `json:"anchor"`
}

// Immutable preloaded public proofs. No HTTP, signer, mutable callback or
// authority lock is entered by the registry's signature/history checks.
// This is infrastructure provenance, not NativeIssuerProof or section 5.3.
type signedAuthorityOrigin struct {
	nativeCoreGrant     *nativeCoreRuntimeGrant
	directoryCheckpoint *sourceVerifiedDirectoryCheckpoint
	registration        sourceRegistration
	historyEnvelope     sourceEnvelope
	issuer              sourceCredential
	anchor              sourceCredential
	verifier            *sourcePublicVerifier
	history             sourceHistoryBody
	prepared            map[string]sourcePreparedRecord
	deadline            time.Time
}

type sourcePreparedRecord struct {
	record   authorityRegistryRecord
	sequence uint64
}

func decodeSourceCanonical(raw []byte, out any, limit int) error {
	if len(raw) == 0 || len(raw) > limit {
		return errSourceProofInvalid
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return errSourceProofInvalid
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return errSourceProofInvalid
	}
	canonical, err := json.Marshal(out)
	if err != nil || !bytes.Equal(raw, canonical) {
		return errSourceProofInvalid
	}
	return nil
}

func sourceASCII(s string, limit int) bool {
	if len(s) == 0 || len(s) > limit {
		return false
	}
	for i := range s {
		if s[i] < 33 || s[i] > 126 {
			return false
		}
	}
	return true
}

func sourceScopeValid(s sourceScope) bool {
	return sourceASCII(s.Source, 512) && sourceASCII(s.Store, 512) && sourceASCII(s.Schema, 512) && sourceASCII(s.Inode, 512) && sourceASCII(s.Restore, 512) && s.SourceGeneration > 0 && s.NativeRestoreIncarnation > 0
}

func sourceBytes(s string, min, max int) ([]byte, error) {
	if len(s) > base64.RawURLEncoding.EncodedLen(max) {
		return nil, errSourceProofInvalid
	}
	b, err := base64.RawURLEncoding.Strict().DecodeString(s)
	if err != nil || len(b) < min || len(b) > max || base64.RawURLEncoding.EncodeToString(b) != s {
		return nil, errSourceProofInvalid
	}
	return b, nil
}

func sourceDigestOK(s string) bool {
	if len(s) != 64 {
		return false
	}
	for i := range s {
		if !((s[i] >= '0' && s[i] <= '9') || (s[i] >= 'a' && s[i] <= 'f')) {
			return false
		}
	}
	return true
}

func sourceSigningInput(role string, body []byte) ([]byte, error) {
	switch role {
	case "credential", "record-issuer", "record-anchor", "current-history", "directory-checkpoint":
	default:
		return nil, errSourceProofInvalid
	}
	if len(body) == 0 || len(body) > sourceProofLimit {
		return nil, errSourceProofInvalid
	}
	// New source-proof framing only; selected signature context, primitive,
	// PQXDH/KDF/AEAD/ratchet and the NOT_ADMITTED handshake are unchanged.
	var b bytes.Buffer
	b.WriteString("YNX/SOCIAL/SOURCE-PROOF/V1\x00")
	b.WriteByte(byte(len(role)))
	b.WriteString(role)
	var n [4]byte
	binary.BigEndian.PutUint32(n[:], uint32(len(body)))
	b.Write(n[:])
	b.Write(body)
	if b.Len() > 49152 {
		return nil, errSourceProofInvalid
	}
	return b.Bytes(), nil
}

func (v *sourcePublicVerifier) verifyEnvelope(ctx context.Context, e sourceEnvelope, role string, key sourcePair) ([]byte, error) {
	if e.Version != 1 || e.Role != role {
		return nil, errSourceProofInvalid
	}
	body, err := sourceBytes(e.Body, 1, sourceProofLimit)
	if err != nil {
		return nil, err
	}
	message, err := sourceSigningInput(role, body)
	if err != nil {
		return nil, err
	}
	if err = v.verify(ctx, key, message, e.Signature); err != nil {
		return nil, err
	}
	return body, nil
}

func (o *signedAuthorityOrigin) prepareRecordSignatures(ctx context.Context, r authorityRegistryRecord) error {
	if o == nil || o.verifier == nil {
		return errSourceRegistrationRequired
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if !sourceASCII(r.Binding.Issuer, 512) || r.Binding.Issuer != o.issuer.Authority || r.Binding.Source != o.issuer.Scope.Source || r.Binding.Store != o.issuer.Scope.Store || r.Binding.Schema != o.issuer.Scope.Schema || r.Binding.Inode != o.issuer.Scope.Inode || r.Binding.Restore != o.issuer.Scope.Restore {
		return errSourceProofInvalid
	}
	var disposition string
	switch r.Kind {
	case "grant":
		disposition = "GRANT_RECORDED"
	case "revoke":
		disposition = "REVOKE_RECORDED"
	case "inflight":
		disposition = "INFLIGHT_RECORDED"
	case "unknown":
		disposition = "UNKNOWN_RECORDED"
	case "final":
		disposition = "FINAL_RECORDED"
	default:
		return errSourceProofInvalid
	}
	var proof sourceRecordProof
	if err := decodeSourceCanonical(r.Proof, &proof, sourceProofLimit); err != nil {
		return err
	}
	if proof.Version != 1 {
		return errSourceProofInvalid
	}
	body, err := o.verifier.verifyEnvelope(ctx, proof.Issuer, "record-issuer", o.issuer.Public)
	if err != nil {
		return err
	}
	var record sourceRecordBody
	if err = decodeSourceCanonical(body, &record, sourceProofLimit); err != nil {
		return err
	}
	if record.Version != 1 || record.Scope != o.issuer.Scope || record.Kind != r.Kind || record.Binding != r.Binding || record.RevokedThrough != r.RevokedThrough {
		return errSourceProofInvalid
	}
	anchorRaw, err := o.verifier.verifyEnvelope(ctx, proof.Anchor, "record-anchor", o.anchor.Public)
	if err != nil {
		return err
	}
	var anchor sourceRecordAnchor
	if err = decodeSourceCanonical(anchorRaw, &anchor, sourceProofLimit); err != nil {
		return err
	}
	issuerRaw, err := json.Marshal(proof.Issuer)
	if err != nil {
		return errSourceProofInvalid
	}
	digest := sha256.Sum256(issuerRaw)
	if anchor.Version != 1 || anchor.Scope != o.anchor.Scope || anchor.Sequence == 0 || anchor.Disposition != disposition || anchor.IssuerEnvelopeDigest != hex.EncodeToString(digest[:]) {
		return errSourceProofInvalid
	}
	// FINAL_RECORDED is a signed infrastructure fact, not a native commit,
	// publish permission, disposal result or once-only receiver.
	return nil
}

// Registry callers already hold their own exclusion. No child process, RPC or
// user callback may run here. The private loader fully authenticates the exact
// catalog before creating this immutable proof cache.
func (o *signedAuthorityOrigin) verifyAuthorityRecord(ctx context.Context, r authorityRegistryRecord) error {
	if o == nil {
		return errSourceRegistrationRequired
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if !o.current() {
		return errSourceHistoryRequired
	}
	if len(r.Proof) == 0 || len(r.Proof) > sourceProofLimit {
		return errSourceProofInvalid
	}
	digest := sha256.Sum256(r.Proof)
	prepared, ok := o.prepared[hex.EncodeToString(digest[:])]
	if !ok || prepared.record.Binding != r.Binding || prepared.record.Kind != r.Kind || prepared.record.RevokedThrough != r.RevokedThrough || !bytes.Equal(prepared.record.Proof, r.Proof) {
		return errSourceProofInvalid
	}
	return nil
}

func (o *signedAuthorityOrigin) current() bool {
	return o.currentAt(time.Now())
}

// Same lower-inclusive, upper-exclusive interval for live effects and replay.
func sourceHistoryContainsTime(h sourceHistoryBody, ms int64) bool {
	return ms >= h.IssuedMS && ms < h.ExpiresMS
}

func (o *signedAuthorityOrigin) currentAt(now time.Time) bool {
	return o != nil && !o.deadline.IsZero() && now.Before(o.deadline) && sourceHistoryContainsTime(o.history, now.UnixMilli())
}

func (o *signedAuthorityOrigin) admitAuthorityHistory(ctx context.Context, rows []authorityRegistryRecord, head string) error {
	if !o.current() || !sourceDigestOK(head) || uint64(len(rows)) != o.history.Records || head != o.history.Head {
		return errSourceHistoryRequired
	}
	catalog := sha256.New()
	for i, r := range rows {
		if err := o.verifyAuthorityRecord(ctx, r); err != nil {
			return err
		}
		digest := sha256.Sum256(r.Proof)
		if o.prepared[hex.EncodeToString(digest[:])].sequence != uint64(i+1) {
			return errSourceProofInvalid
		}
		raw, err := json.Marshal(r)
		if err != nil {
			return errSourceProofInvalid
		}
		catalog.Write(raw)
		catalog.Write([]byte{'\n'})
	}
	if hex.EncodeToString(catalog.Sum(nil)) != o.history.CatalogDigest {
		return errSourceHistoryRequired
	}
	return nil
}

func sourcePublicPairValid(key sourcePair) bool {
	classic, err := sourceBytes(key.Classic, 33, 33)
	if err != nil || classic[0] != 5 {
		return false
	}
	_, err = sourceBytes(key.PQ, 2592, 2592)
	return err == nil
}

func sourcePublicComponentsDistinct(a, b sourcePair) bool {
	return a.Classic != b.Classic && a.PQ != b.PQ
}

func loadSourceCredential(ctx context.Context, envelope sourceEnvelope, role string, profiles map[string]sourceBootstrapProfile) (sourceCredential, *sourcePublicVerifier, error) {
	var credential sourceCredential
	body, err := sourceBytes(envelope.Body, 1, sourceProofLimit)
	if err != nil {
		return credential, nil, err
	}
	if decodeSourceCanonical(body, &credential, sourceProofLimit) != nil || credential.Version != 1 || credential.Role != role || !sourceScopeValid(credential.Scope) || !sourceASCII(credential.Authority, 512) || credential.Epoch == 0 || !sourcePublicPairValid(credential.Public) {
		return credential, nil, errSourceProofInvalid
	}
	if credential.Issuance != nil && !sourceIssuancePolicyValid(*credential.Issuance, role) {
		return credential, nil, errSourceProofInvalid
	}
	if credential.DeviceRevocation != nil && !sourceDeviceRevocationPolicyValid(*credential.DeviceRevocation, role) {
		return credential, nil, errSourceProofInvalid
	}
	if credential.DeviceDirectoryRead != nil && !sourceDeviceDirectoryReadPolicyValid(credential.DeviceDirectoryRead, role) {
		return credential, nil, errSourceProofInvalid
	}
	if credential.DeviceRevocationSigning != nil && !sourceDeviceRevocationSigningPolicyValid(credential.DeviceRevocationSigning, role) {
		return credential, nil, errSourceProofInvalid
	}
	if credential.DeviceSessionPrincipal != nil && !socialDeviceSessionPrincipalPolicyValid(credential.DeviceSessionPrincipal,role) { return credential,nil,errSourceProofInvalid }
	if credential.FirstEnrollment != nil && !sourceFirstEnrollmentPolicyValid(*credential.FirstEnrollment) {
		return credential, nil, errSourceProofInvalid
	}
	if credential.FirstPrepared != nil && !sourceFirstPreparedIssuancePolicyValid(*credential.FirstPrepared, role) {
		return credential, nil, errSourceProofInvalid
	}
	profile, ok := profiles[credential.Bootstrap]
	if !ok {
		return credential, nil, errSourceRegistrationRequired
	}
	expected := profile.IssuerCustodian
	if role == "anchor" {
		expected = profile.AnchorCustodian
	}
	if expected == "" || credential.Custodian != expected {
		return credential, nil, errSourceRegistrationRequired
	}
	verifier, err := newSourcePublicVerifier(profile.Verifier)
	if err != nil {
		return credential, nil, err
	}
	if _, err = verifier.verifyEnvelope(ctx, envelope, "credential", profile.Public); err != nil {
		return credential, nil, err
	}
	return credential, verifier, nil
}

func fetchSourceHistory(ctx context.Context, anchor sourceCredential, verifier *sourcePublicVerifier) (sourceHistoryBody, error) {
	head, _, err := fetchSourceHistoryWithEvidence(ctx, anchor, verifier)
	return head, err
}

func fetchSourceHistoryWithEvidence(ctx context.Context, anchor sourceCredential, verifier *sourcePublicVerifier) (sourceHistoryBody, sourceEnvelope, error) {
	var nonce [32]byte
	if _, err := io.ReadFull(rand.Reader, nonce[:]); err != nil {
		return sourceHistoryBody{}, sourceEnvelope{}, errSourceHistoryRequired
	}
	return fetchSourceHistoryForNonce(ctx, anchor, verifier, nonce)
}

// Native supplies its retained request nonce; no random replacement here.
func fetchSourceHistoryForNonce(ctx context.Context, anchor sourceCredential, verifier *sourcePublicVerifier, nonce [32]byte) (sourceHistoryBody, sourceEnvelope, error) {
	var head sourceHistoryBody
	if verifier == nil {
		return head, sourceEnvelope{}, errSourceVerifierUnavailable
	}
	requestURL, err := sourceHistoryNonceURL(anchor, nonce)
	if err != nil {
		return head, sourceEnvelope{}, err
	}
	nonceText := base64.RawURLEncoding.EncodeToString(nonce[:])
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return head, sourceEnvelope{}, errSourceHistoryRequired
	}
	if relay, _ := ctx.Value(sourceReadProxyContextKey{}).(bool); relay {
		req.Header.Set(sourceReadHopHeader, "1")
	}
	// Fetch BEFORE a registry/authority/native lock; no credentials or payload.
	transport := newSourceHTTPTransport()
	transport.Proxy = nil
	defer transport.CloseIdleConnections()
	client := http.Client{Transport: transport, Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return head, sourceEnvelope{}, errSourceHistoryRequired
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return head, sourceEnvelope{}, errSourceHistoryRequired
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, sourceProofLimit+1))
	if err != nil {
		return head, sourceEnvelope{}, errSourceHistoryRequired
	}
	var envelope sourceEnvelope
	if decodeSourceCanonical(raw, &envelope, sourceProofLimit) != nil {
		return head, sourceEnvelope{}, errSourceProofInvalid
	}
	body, err := verifier.verifyEnvelope(ctx, envelope, "current-history", anchor.Public)
	if err != nil {
		return head, sourceEnvelope{}, err
	}
	if decodeSourceCanonical(body, &head, sourceProofLimit) != nil {
		return head, sourceEnvelope{}, errSourceProofInvalid
	}
	now := time.Now().UnixMilli()
	if head.Version != 1 || head.Authority != anchor.Authority || head.Epoch != anchor.Epoch || head.Scope != anchor.Scope || head.Nonce != nonceText || !sourceDigestOK(head.Head) || !sourceDigestOK(head.CatalogDigest) || head.Records > 4096 || head.IssuedMS > now+5000 || head.ExpiresMS <= now || head.IssuedMS < 0 || head.ExpiresMS <= head.IssuedMS || head.ExpiresMS-head.IssuedMS > 30000 {
		return head, sourceEnvelope{}, errSourceHistoryRequired
	}
	// Wall clock only bounds this response's lifetime. Independent rollback
	// protection relies on the separately enrolled anchor's actual custody.
	if err := ctx.Err(); err != nil {
		return head, sourceEnvelope{}, err
	}
	return head, envelope, nil
}

func prepareSourceCatalog(ctx context.Context, o *signedAuthorityOrigin, reader io.Reader) error {
	// Each record uses the existing registry tuple/encoding, no user payload.
	// No source/VCS/build basename exclusion or inferred empty genesis exists.
	stream := bufio.NewReaderSize(io.LimitReader(reader, 64*1024*1024+1), 49153)
	prepared := make(map[string]sourcePreparedRecord)
	catalog := sha256.New()
	total := 0
	for count := uint64(0); ; count++ {
		line, err := stream.ReadSlice('\n')
		if err == io.EOF && len(line) == 0 {
			if count != o.history.Records || hex.EncodeToString(catalog.Sum(nil)) != o.history.CatalogDigest {
				return errSourceHistoryRequired
			}
			o.prepared = prepared
			return nil
		}
		if err != nil || len(line) < 2 || len(line) > 49152 || count >= o.history.Records {
			return errSourceProofInvalid
		}
		total += len(line)
		if total > 64*1024*1024 {
			return errSourceProofInvalid
		}
		var r authorityRegistryRecord
		if decodeSourceCanonical(line[:len(line)-1], &r, 49151) != nil {
			return errSourceProofInvalid
		}
		if err = o.prepareRecordSignatures(ctx, r); err != nil {
			return err
		}
		var proof sourceRecordProof
		var anchor sourceRecordAnchor
		if decodeSourceCanonical(r.Proof, &proof, sourceProofLimit) != nil {
			return errSourceProofInvalid
		}
		body, err := sourceBytes(proof.Anchor.Body, 1, sourceProofLimit)
		if err != nil {
			return err
		}
		if decodeSourceCanonical(body, &anchor, sourceProofLimit) != nil || anchor.Sequence != count+1 {
			return errSourceProofInvalid
		}
		digest := sha256.Sum256(r.Proof)
		key := hex.EncodeToString(digest[:])
		if _, duplicate := prepared[key]; duplicate {
			return errSourceProofInvalid
		}
		r.Proof = append([]byte(nil), r.Proof...)
		prepared[key] = sourcePreparedRecord{r, count + 1}
		catalog.Write(line)
	}
}

func fetchSourceCatalog(ctx context.Context, o *signedAuthorityOrigin) error {
	u, err := url.Parse(o.anchor.HistoryEndpoint)
	if err != nil {
		return errSourceHistoryRequired
	}
	u.Path = "/v4/source-authority/record-proofs"
	u.RawQuery = url.Values{"nonce": {o.history.Nonce}, "head": {o.history.Head}, "source": {o.anchor.Scope.Source}, "store": {o.anchor.Scope.Store}, "restore": {o.anchor.Scope.Restore}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return errSourceHistoryRequired
	}
	transport := newSourceHTTPTransport()
	transport.Proxy = nil
	defer transport.CloseIdleConnections()
	client := http.Client{Transport: transport, Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return errSourceHistoryRequired
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return errSourceHistoryRequired
	}
	return prepareSourceCatalog(ctx, o, response.Body)
}

// LoadSourceAuthority checks PUBLIC registration material only. Approved roots
// and verifier images remain source-owned and currently empty. No key is read,
// generated, signed, issued or accepted just because it appears in this file.
func LoadSourceAuthority(ctx context.Context, path string) (*SourceAuthorityRuntime, error) {
	profiles, err := approvedSourceBootstrapProfiles(ctx)
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, errSourceRegistrationRequired
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, errSourceRegistrationRequired
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > 65536 {
		return nil, errSourceProofInvalid
	}
	raw, err := io.ReadAll(io.LimitReader(f, 65537))
	if err != nil {
		return nil, errSourceProofInvalid
	}
	var registration sourceRegistration
	if decodeSourceCanonical(raw, &registration, 65536) != nil || registration.Version != 1 {
		return nil, errSourceProofInvalid
	}
	issuer, verifier, err := loadSourceCredential(ctx, registration.Issuer, "issuer", profiles)
	if err != nil {
		return nil, err
	}
	anchor, anchorVerifier, err := loadSourceCredential(ctx, registration.Anchor, "anchor", profiles)
	if err != nil {
		return nil, err
	}
	if issuer.Scope != anchor.Scope || issuer.Authority == anchor.Authority || issuer.Custodian == anchor.Custodian || !sourcePublicComponentsDistinct(issuer.Public, anchor.Public) || verifier.image != anchorVerifier.image {
		return nil, errSourceRegistrationRequired
	}
	head, historyEnvelope, err := fetchSourceHistoryWithEvidence(ctx, anchor, verifier)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	origin := &signedAuthorityOrigin{registration: registration, historyEnvelope: historyEnvelope, issuer: issuer, anchor: anchor, verifier: verifier, history: head, deadline: now.Add(time.Duration(head.ExpiresMS-now.UnixMilli()) * time.Millisecond)}
	if profile := profiles[issuer.Bootstrap]; profile.NativeCoreReleaseOriginal != "" {
		origin.nativeCoreGrant, err = origin.authenticateNativeCoreRuntimeGrant(ctx, profile)
		if err != nil {
			return nil, err
		}
	}
	if err = fetchSourceCatalog(ctx, origin); err != nil {
		return nil, err
	}
	if !origin.current() {
		return nil, errSourceHistoryRequired
	}
	if err = origin.prepareDirectoryCheckpoint(ctx); err != nil {
		return nil, err
	}
	return &SourceAuthorityRuntime{origin: origin}, nil
}

type SourceAuthorityRuntime struct {
	origin *signedAuthorityOrigin
	// Original launcher-supplied sealed inputs, not a Go permit or public config.
	protectedRoles *sourceProtectedRoleInputs
}
type sourceProtectedRoleMaterial struct {
	ordinaryResource                    [32]byte
	role                                string
	sealed                              bool
	inputs                              *sourceProtectedRoleInputs
	wrapping                            *os.File
	credential, pqRecord, classicRecord []byte
}
type sourceProtectedRoleInputs struct {
	ordinary      *sourceOrdinaryPublicInputs
	bundleSlots   [4]bool
	bundleDigests [4][2][32]byte
	startup       *sourceNativeStartupInputs
	origin        *signedAuthorityOrigin
	roles         [4]*sourceProtectedRoleMaterial
	mu            sync.Mutex
	sealed        bool
	files         []*sourceSealedInputFile
	first         error
	closed        bool
}

// Retained unadmitted encrypted/public originals. None of these fields is a
// signing permit, a wrapping secret, or an independently authenticated profile.
type sourceSealedInputFile struct {
	path             string
	file, parent     *os.File
	root             *os.Root
	info, parentInfo os.FileInfo
	raw              []byte
	digest           [32]byte
	closeAttempted   bool
	closeResult      error
}

// Public status is deliberately not a device/session/receipt factory. Native
// custody, joint identity, key reload and bilateral activation remain required.
func (r *SourceAuthorityRuntime) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if r.servePublicSourceRead(w, req) {
			return
		}
		if req.URL.Path == "/v4/source-authority/status" && req.Method == http.MethodGet {
			validated := r != nil && r.origin.current()
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(struct {
				Version         int    `json:"version"`
				SourceValidated bool   `json:"sourceValidated"`
				PrivateReady    bool   `json:"privateCommunicationReady"`
				Code            string `json:"code"`
			}{1, validated, false, "SOCIAL_NATIVE_COMPOSITION_REQUIRED"})
			return
		}
		// Never route a failed new-core request to a legacy/private service.
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = fmt.Fprintln(w, `{"code":"SOCIAL_NEW_CORE_REQUIRED"}`)
	})
}

// Exact URL builder shared by normal fresh-nonce fetch and PUBLIC controls.
func sourceHistoryNonceURL(anchor sourceCredential, nonce [32]byte) (string, error) {
	u, err := url.Parse(anchor.HistoryEndpoint)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" || u.RawQuery != "" || u.ForceQuery || u.Path != "/v4/source-authority/current-history" {
		return "", errSourceProofInvalid
	}
	u.RawQuery = url.Values{"nonce": {base64.RawURLEncoding.EncodeToString(nonce[:])}, "source": {anchor.Scope.Source}, "store": {anchor.Scope.Store}, "restore": {anchor.Scope.Restore}}.Encode()
	return u.String(), nil
}
