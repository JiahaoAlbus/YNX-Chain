package developerauthority

// Normal pinned-process callee for R192 dual publisher DATA. A Source must not
// cast this into ProtectedPublisher before original custodian-role/current,
// revoke, ACL and durable registration checks. No callback/Root/signer here.
import (
	"bytes"
	"context"
	"time"
)

func (o *OriginalSourceVerifierOwner) invokeOriginalProtectedPublisherDATA(ctx context.Context, input []byte, p Principal, c Command, publicOriginal, registrationOriginal []byte, registrationRef string) ([]byte, error) {
	now := time.Now().UnixMilli()
	if len(input) == 0 || len(input) > originalVerifierInputLimit || !principalValid(p, now) || !c.valid(now) || c.Action != "project.publisher" || c.Revoke || len(publicOriginal) == 0 || len(publicOriginal) > 8192 || hash(publicOriginal) != c.PublicOriginalSHA256 || len(registrationOriginal) == 0 || len(registrationOriginal) > 786432 || !text(registrationRef) {
		return nil, ErrDenied
	}
	return o.invokeDATA(ctx, input, 8192, false, func(raw []byte, before time.Time) string {
		if !bytes.HasSuffix(raw, []byte("\n")) {
			return "PUBLISHER_OUTPUT"
		}
		var account, project, publisher, role, publicSHA, ref, principalSHA, commandSHA, proofSHA string
		var expires int64
		var verified, independent, data, authorized, registered, protected, admission bool
		if decodeExactObject(bytes.TrimSuffix(raw, []byte("\n")), 8192, map[string]any{"account": &account, "projectId": &project, "publisherId": &publisher, "keyRole": &role, "publicSHA256": &publicSHA, "registrationRef": &ref, "principalSHA256": &principalSHA, "commandSHA256": &commandSHA, "proofSHA256": &proofSHA, "expiresAtMs": &expires, "signatureVerified": &verified, "independentCustodianPairVerified": &independent, "dataOnly": &data, "authorized": &authorized, "registered": &registered, "protectedCustodyAdmitted": &protected, "nativeAdmission": &admission}) != nil {
			return "PUBLISHER_OUTPUT"
		}
		if account != c.SubjectAccount || project != c.ProjectID || publisher != c.PublisherID || role != "ide-artifact-publisher" || publicSHA != hash(publicOriginal) || ref != registrationRef || principalSHA != objectHash(p) || commandSHA != objectHash(c) || proofSHA != hash(registrationOriginal) || !verified || !independent || !data || authorized || registered || protected || admission {
			return "PUBLISHER_BINDING"
		}
		after := time.Now().UnixMilli()
		if after < before.UnixMilli() || expires <= after || expires > p.ExpiresMS || expires > c.ExpiresMS || expires > c.GrantExpiresMS || expires-before.UnixMilli() > 30000 {
			return "PUBLISHER_EXPIRED"
		}
		return ""
	})
}
