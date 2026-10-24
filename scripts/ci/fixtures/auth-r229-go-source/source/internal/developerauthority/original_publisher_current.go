package developerauthority

// Normal pinned-process counterpart of the exact R211 publisher/current
// dispatcher. These are retained original DATA/current observations, NOT a
// ProtectedPublisher, database registration, consent or Source13 factory.
import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"sync"
	"time"
)

type originalPublisherProjection struct {
	Account              string `json:"account"`
	ProjectID            string `json:"projectId"`
	PublisherID          string `json:"publisherId"`
	KeyRole              string `json:"keyRole"`
	PublicSHA256         string `json:"publicSHA256"`
	RegistrationRef      string `json:"registrationRef"`
	PrincipalSHA256      string `json:"principalSHA256"`
	CommandSHA256        string `json:"commandSHA256"`
	ProofSHA256          string `json:"proofSHA256"`
	ExpiresMS            int64  `json:"expiresAtMs"`
	SignatureVerified    bool   `json:"signatureVerified"`
	IndependentCustodian bool   `json:"independentCustodianPairVerified"`
	DataOnly             bool   `json:"dataOnly"`
	Authorized           bool   `json:"authorized"`
	Registered           bool   `json:"registered"`
	Protected            bool   `json:"protectedCustodyAdmitted"`
	Native               bool   `json:"nativeAdmission"`
}
type originalPublisherCurrent struct {
	mu                                         sync.Mutex
	firstCause                                 error
	verifiedAt                                 time.Time
	projection                                 originalPublisherProjection
	before, after, original                    []byte
	sourceID, instanceID, profile, head, nonce string
	generation, sequence, floor                uint64
	reviewExpiresMS                            int64
}

func (*originalPublisherCurrent) String() string {
	return "originalPublisherCurrent{original DATA/current retained privately; not authority}"
}
func (r *originalPublisherCurrent) GoString() string { return r.String() }

func decodePublisherProjection(raw []byte, r *originalPublisherProjection) error {
	return decodeExactObject(raw, 8192, map[string]any{"account": &r.Account, "projectId": &r.ProjectID, "publisherId": &r.PublisherID, "keyRole": &r.KeyRole, "publicSHA256": &r.PublicSHA256, "registrationRef": &r.RegistrationRef, "principalSHA256": &r.PrincipalSHA256, "commandSHA256": &r.CommandSHA256, "proofSHA256": &r.ProofSHA256, "expiresAtMs": &r.ExpiresMS, "signatureVerified": &r.SignatureVerified, "independentCustodianPairVerified": &r.IndependentCustodian, "dataOnly": &r.DataOnly, "authorized": &r.Authorized, "registered": &r.Registered, "protectedCustodyAdmitted": &r.Protected, "nativeAdmission": &r.Native})
}

// Read only the SAME independently authenticated Source selection. Expected
// nonce may not come from the proof being checked, a renderer DTO or a new RNG.
func originalPublisherCaptureMatches(source originalControlSourceProjection, p Principal, c Command, public []byte, caller, registrationRef string, at int64) (string, int64, bool) {
	if !originalControlCaptureMatches(source, p, c, caller, at) {
		return "", 0, false
	}
	var selection struct {
		Capture      json.RawMessage `json:"projectControlCapture"`
		Registration json.RawMessage `json:"projectPublisherRegistrationCapture"`
	}
	if json.Unmarshal(source.Selection, &selection) != nil || hash(selection.Capture) != source.Head {
		return "", 0, false
	}
	var capture struct {
		Review struct {
			Publisher json.RawMessage `json:"publisher"`
		} `json:"review"`
	}
	if json.Unmarshal(selection.Capture, &capture) != nil {
		return "", 0, false
	}
	var account, project, publisher, role, publicSHA, ref, expires string
	if decodeExactObject(capture.Review.Publisher, 4096, map[string]any{"Account": &account, "ProjectID": &project, "PublisherID": &publisher, "KeyRole": &role, "PublicSHA256": &publicSHA, "RegistrationRef": &ref, "ExpiresMS": &expires}) != nil {
		return "", 0, false
	}
	end, e := strconv.ParseInt(expires, 10, 64)
	if e != nil || strconv.FormatInt(end, 10) != expires || end < c.GrantExpiresMS || account != c.SubjectAccount || project != c.ProjectID || publisher != c.PublisherID || role != "ide-artifact-publisher" || publicSHA != hash(public) || !text(ref) || ref != registrationRef {
		return "", 0, false
	}
	var version, request, registration, nonce, principalSHA, commandSHA, registrationPublicSHA string
	if decodeExactObject(selection.Registration, 4096, map[string]any{"version": &version, "requestId": &request, "registrationRef": &registration, "nonce": &nonce, "principalSHA256": &principalSHA, "commandSHA256": &commandSHA, "publicSHA256": &registrationPublicSHA}) != nil {
		return "", 0, false
	}
	n, e := base64.RawURLEncoding.Strict().DecodeString(nonce)
	if e != nil || len(n) != 32 || bytes.Equal(n, make([]byte, 32)) || base64.RawURLEncoding.EncodeToString(n) != nonce || version != "YNX-IDE-PUBLISHER-REGISTRATION-CAPTURE/v1" || request != c.RequestID || registration != ref || principalSHA != objectHash(p) || commandSHA != objectHash(c) || registrationPublicSHA != publicSHA {
		return "", 0, false
	}
	return nonce, end, true
}

func (o *OriginalSourceVerifierOwner) invokeOriginalProtectedPublisherCurrent(ctx context.Context, input []byte, p Principal, c Command, public, proof []byte, caller string) (*originalPublisherCurrent, error) {
	at := time.Now().UnixMilli()
	if len(input) == 0 || len(input) > originalVerifierInputLimit || !principalValid(p, at) || !c.valid(at) || c.Action != "project.publisher" || c.Revoke || len(public) == 0 || len(public) > 8192 || hash(public) != c.PublicOriginalSHA256 || len(proof) == 0 || len(proof) > 786432 || !text(caller) {
		return nil, ErrDenied
	}
	var operation, registration string
	var source, principal, command json.RawMessage
	if decodeExactObject(input, originalVerifierInputLimit, map[string]any{"operation": &operation, "source": &source, "registrationOriginal": &registration, "principal": &principal, "command": &command}) != nil || operation != "ide-protected-publisher-current-native-node/v1" || registration != string(proof) {
		return nil, ErrDenied
	}
	var sourceFields map[string]json.RawMessage
	var frozenProfile string
	var policy struct {
		Signature struct {
			Purpose string `json:"purpose"`
		} `json:"signatureContract"`
	}
	if json.Unmarshal(source, &sourceFields) != nil || json.Unmarshal(sourceFields["profileRaw"], &frozenProfile) != nil || frozenProfile == "" || json.Unmarshal(sourceFields["policy"], &policy) != nil || policy.Signature.Purpose != "ide-project-control-authority-v1" {
		return nil, ErrDenied
	}
	var selected *originalPublisherCurrent
	raw, e := o.invokeDATA(ctx, input, originalVerifierOutputLimit, false, func(raw []byte, before time.Time) string {
		var version, failure, original string
		var completed, data, authorized, registered, protected, native bool
		var first, last, projection json.RawMessage
		if !bytes.HasSuffix(raw, []byte("\n")) || decodeExactObject(bytes.TrimSuffix(raw, []byte("\n")), originalVerifierOutputLimit, map[string]any{"version": &version, "completed": &completed, "sourceBefore": &first, "sourceAfter": &last, "registrationOriginal": &original, "projection": &projection, "failureCode": &failure, "dataOnly": &data, "authorized": &authorized, "registered": &registered, "protectedCustodyAdmitted": &protected, "nativeAdmission": &native}) != nil || version != "YNX-IDE-PUBLISHER-CURRENT-VERIFICATION-DATA/v1" || !completed || failure != "" || original != string(proof) || !data || authorized || registered || protected || native {
			return "PUBLISHER_CURRENT_OUTPUT"
		}
		a, err := controlSourceProjection(first, before)
		if err != nil {
			return "PUBLISHER_CURRENT_BEFORE"
		}
		b, err := controlSourceProjection(last, before)
		if err != nil {
			return "PUBLISHER_CURRENT_AFTER"
		}
		if a.Profile != hash([]byte(frozenProfile)) || a.Profile != b.Profile || a.SourceID != b.SourceID || a.InstanceID != b.InstanceID || a.Principal != b.Principal || a.Owner != b.Owner || a.KeyVersion != b.KeyVersion || a.Generation != b.Generation || a.Sequence != b.Sequence || a.Floor != b.Floor || a.Head != b.Head || !bytes.Equal(a.Selection, b.Selection) {
			return "PUBLISHER_CURRENT_CHANGED"
		}
		ah, ae := strconv.ParseUint(a.Height, 10, 64)
		bh, be := strconv.ParseUint(b.Height, 10, 64)
		if ae != nil || be != nil || bh < ah || b.TimeFloor < a.TimeFloor {
			return "PUBLISHER_CURRENT_ROLLBACK"
		}
		var r originalPublisherProjection
		if decodePublisherProjection(projection, &r) != nil || r.Account != c.SubjectAccount || r.ProjectID != c.ProjectID || r.PublisherID != c.PublisherID || r.KeyRole != "ide-artifact-publisher" || r.PublicSHA256 != hash(public) || !text(r.RegistrationRef) || r.PrincipalSHA256 != objectHash(p) || r.CommandSHA256 != objectHash(c) || r.ProofSHA256 != hash(proof) || !r.SignatureVerified || !r.IndependentCustodian || !r.DataOnly || r.Authorized || r.Registered || r.Protected || r.Native {
			return "PUBLISHER_CURRENT_PROJECTION"
		}
		after := time.Now().UnixMilli()
		nonce, end, ok := originalPublisherCaptureMatches(a, p, c, public, caller, r.RegistrationRef, after)
		lastNonce, lastEnd, lastOK := originalPublisherCaptureMatches(b, p, c, public, caller, r.RegistrationRef, after)
		if !ok || !lastOK || nonce != lastNonce || end != lastEnd || after < before.UnixMilli() || after >= r.ExpiresMS || r.ExpiresMS > p.ExpiresMS || r.ExpiresMS > c.ExpiresMS || r.ExpiresMS > c.GrantExpiresMS || r.ExpiresMS-before.UnixMilli() > 30000 || after >= a.Expires || after >= b.Expires {
			return "PUBLISHER_CURRENT_EXPIRED_OR_CAPTURE"
		}
		var body struct {
			RegistrationOriginal string `json:"registrationOriginal"`
		}
		var signed struct {
			Nonce        string `json:"nonce"`
			Registration string `json:"registrationRef"`
		}
		if json.Unmarshal(proof, &body) != nil || json.Unmarshal([]byte(body.RegistrationOriginal), &signed) != nil || signed.Nonce != nonce || signed.Registration != r.RegistrationRef {
			return "PUBLISHER_CURRENT_NONCE_OR_REFERENCE"
		}
		selected = &originalPublisherCurrent{verifiedAt: before, projection: r, before: append([]byte(nil), first...), after: append([]byte(nil), last...), sourceID: a.SourceID, instanceID: a.InstanceID, profile: a.Profile, head: a.Head, nonce: nonce, generation: a.Generation, sequence: a.Sequence, floor: a.Floor, reviewExpiresMS: end}
		return ""
	})
	if selected != nil {
		selected.original = append([]byte(nil), raw...)
	}
	return selected, e
}

// Completion fence for the owning registry writer immediately after its
// awaited SQL step. This does not fetch/renew Source or role, issue a nonce,
// retry the verification or make DATA into a registration. Fresh current/revoke
// checks remain separate; this only prevents an old observation surviving IO.
func (r *originalPublisherCurrent) recheckOriginalCompletion(ctx context.Context, p Principal, c Command, public, proof []byte, caller string) error {
	if r == nil {
		return ErrDenied
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.firstCause != nil {
		return ErrUnknown
	}
	fail := func(cause error) error {
		if r.firstCause == nil {
			r.firstCause = cause
		}
		return ErrUnknown
	}
	if ctx == nil {
		return fail(ErrDenied)
	}
	if e := ctx.Err(); e != nil {
		return fail(e)
	}
	at := time.Now().UnixMilli()
	if len(r.original) == 0 || r.verifiedAt.IsZero() || !principalValid(p, at) || !c.valid(at) || r.projection.PrincipalSHA256 != objectHash(p) || r.projection.CommandSHA256 != objectHash(c) || r.projection.PublicSHA256 != hash(public) || r.projection.ProofSHA256 != hash(proof) || at < r.verifiedAt.UnixMilli() || at >= r.projection.ExpiresMS {
		return fail(ErrDenied)
	}
	var views []originalControlSourceProjection
	for _, raw := range [][]byte{r.before, r.after} {
		s, e := controlSourceProjection(raw, r.verifiedAt)
		if e != nil {
			return fail(e)
		}
		nonce, end, ok := originalPublisherCaptureMatches(s, p, c, public, caller, r.projection.RegistrationRef, at)
		if !ok || nonce != r.nonce || end != r.reviewExpiresMS || s.SourceID != r.sourceID || s.InstanceID != r.instanceID || s.Profile != r.profile || s.Head != r.head || s.Generation != r.generation || s.Sequence != r.sequence || s.Floor != r.floor {
			return fail(ErrDenied)
		}
		views = append(views, s)
	}
	// All decoders/current checks have completed. One final local sample binds
	// BOTH captured windows, rather than expiring the first while checking last.
	finalAt := time.Now().UnixMilli()
	if finalAt < at || !principalValid(p, finalAt) || !c.valid(finalAt) || finalAt >= r.projection.ExpiresMS {
		return fail(ErrDenied)
	}
	for _, s := range views {
		if _, _, ok := originalPublisherCaptureMatches(s, p, c, public, caller, r.projection.RegistrationRef, finalAt); !ok || finalAt < s.TimeFloor || finalAt >= s.Expires {
			return fail(ErrDenied)
		}
	}
	if e := ctx.Err(); e != nil {
		return fail(e)
	}
	return nil
}
