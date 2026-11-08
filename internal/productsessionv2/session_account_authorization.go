package productsessionv2

import (
	"regexp"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

// SessionAccountAuthorization is the existing sole SDK's exact nine-field
// accountAuthorization for a v3 session over the unchanged v2 HTTP protocol.
// This projection cannot independently establish a committed/current account:
// Client.Authorize still requires the original fixed live authority response,
// sender/product/scopes/current proof, and the product's own business policy.
type SessionAccountAuthorization struct {
	PolicyVersion    string `json:"policyVersion"`
	AlgorithmVersion string `json:"algorithmVersion"`
	NetworkID        string `json:"networkId"`
	CanonicalOwner   string `json:"canonicalOwner"`
	Revision         string `json:"revision"`
	RegisteredAt     string `json:"registeredAt"`
	ActiveFrom       string `json:"activeFrom"`
	PkA              string `json:"pkA"`
	PkB              string `json:"pkB"`
}

var sessionAccountAuthorizationFields = []string{
	"policyVersion", "algorithmVersion", "networkId", "canonicalOwner",
	"revision", "registeredAt", "activeFrom", "pkA", "pkB",
}
var authorizationU64 = regexp.MustCompile(`^(0|[1-9][0-9]{0,19})$`)

func authorizationHex(value string, length int) bool {
	if len(value) != length {
		return false
	}
	for _, c := range value {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

func accountAuthorizationInteger(value any) (uint64, bool) {
	s, ok := value.(string)
	if !ok || !authorizationU64.MatchString(s) {
		return 0, false
	}
	n, err := strconv.ParseUint(s, 10, 64)
	return n, err == nil
}

// Conforms to original parseSessionAccountAuthorization(value, account), not
// a second cryptographic verifier. Use the existing checksummed account codec;
// never cast ynx text to a 0x owner or substitute a caller-supplied identity.
func parseSessionAccountAuthorization(value map[string]any, account string) (*SessionAccountAuthorization, error) {
	refuse := func() (*SessionAccountAuthorization, error) {
		return nil, fail("PQ_SESSION_ACCOUNT_BINDING_INVALID", 403)
	}
	if !exactKeys(value, sessionAccountAuthorizationFields) || !accountPattern.MatchString(account) {
		return refuse()
	}
	owner, err := accountaddress.Decode(account)
	if err != nil || text(value, "canonicalOwner") != owner ||
		text(value, "policyVersion") != "YNX-ACCOUNT-POLICY/v1" ||
		text(value, "algorithmVersion") != "YNX-BATCH/v0.1" ||
		!hexDigest.MatchString(text(value, "networkId")) ||
		!authorizationHex(text(value, "pkA"), 5184) ||
		!authorizationHex(text(value, "pkB"), 128) {
		return refuse()
	}
	revision, rOK := accountAuthorizationInteger(value["revision"])
	registered, gOK := accountAuthorizationInteger(value["registeredAt"])
	active, aOK := accountAuthorizationInteger(value["activeFrom"])
	if !rOK || !gOK || !aOK || revision == 0 || registered >= active {
		return refuse()
	}
	return &SessionAccountAuthorization{
		PolicyVersion: text(value, "policyVersion"), AlgorithmVersion: text(value, "algorithmVersion"),
		NetworkID: text(value, "networkId"), CanonicalOwner: owner,
		Revision: text(value, "revision"), RegisteredAt: text(value, "registeredAt"), ActiveFrom: text(value, "activeFrom"),
		PkA: text(value, "pkA"), PkB: text(value, "pkB"),
	}, nil
}
