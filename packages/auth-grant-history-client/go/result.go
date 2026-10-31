package originalclient

import (
	"bytes"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	"reflect"
	"strconv"
	policy "ynx.local/authgrantpolicy"
)

// PRIVATE original service DATA, not a new OPEN codec or a Source authority.
// Caller owns these copies and may encrypt them before invoking the model.
type TaskResourceResult struct {
	OperationID, RemoteRef, AuthScope string
	Source                            policy.Source
	ResponseBinding                   policy.Bind
	ResponseOriginal, SourceBytes     []byte
}

func bindResult(v []byte) policy.Bind {
	a, b := sha3.Sum512(v), sha512.Sum512(v)
	return policy.Bind{Bytes: strconv.Itoa(len(v)), SHA3_512: hex.EncodeToString(a[:]), SHA512: hex.EncodeToString(b[:])}
}
func validateOriginalResultBytes(r OriginalReceipt) error {
	if len(r.ResponseOriginal) < 1 || len(r.ResponseOriginal) > 1048576 || len(r.SourceBytes) < 1 || len(r.SourceBytes) > 1048576 {
		return ErrBinding
	}
	a, b := bindResult(r.ResponseOriginal), bindResult(r.SourceBytes)
	if a.Bytes != r.ResponseBinding.Bytes || a.SHA3_512 != r.ResponseBinding.SHA3_512 || a.SHA512 != r.ResponseBinding.SHA512 || b.Bytes != r.Source.Binding.Bytes || b.SHA3_512 != r.Source.Binding.SHA3_512 || b.SHA512 != r.Source.Binding.SHA512 {
		return ErrBinding
	}
	return nil
}
func cloneTaskResource(in *TaskResourceResult) *TaskResourceResult {
	if in == nil {
		return nil
	}
	out := *in
	out.ResponseOriginal = bytes.Clone(in.ResponseOriginal)
	out.SourceBytes = bytes.Clone(in.SourceBytes)
	out.Source.Fields = append([]string(nil), in.Source.Fields...)
	return &out
}
func validateTaskResource(in *TaskResourceResult, operation string, grant open.BoundGrantV1) error {
	if in == nil || in.OperationID != operation || in.RemoteRef == "" || len(in.RemoteRef) > 4096 || in.AuthScope != "egress-only-read-fence" || len(in.ResponseOriginal) < 1 || len(in.ResponseOriginal) > 1048576 || len(in.SourceBytes) < 1 || len(in.SourceBytes) > 1048576 || bindResult(in.ResponseOriginal) != in.ResponseBinding || bindResult(in.SourceBytes) != in.Source.Binding {
		return ErrBinding
	}
	for _, s := range grant.Binding.Sources {
		if s.Ref.Realm == in.Source.Resource.Realm && s.Ref.Tenant == in.Source.Resource.Tenant && s.Ref.Kind == in.Source.Resource.Kind && s.Ref.ID == in.Source.Resource.ID && s.Ref.Rev == in.Source.Resource.Revision && s.Label == in.Source.Label && reflect.DeepEqual(s.Fields, in.Source.Fields) {
			return nil
		}
	}
	return ErrBinding
}

// Original PRIVATE service JSON uses the existing shared ref's "rev" key;
// formal policy Ref uses Revision internally. Never guess/rename the public
// OPEN schema or treat an ignored unknown rev as zero revision.
func (r *TaskResourceResult) UnmarshalJSON(raw []byte) error {
	var wire struct {
		OperationID, RemoteRef, AuthScope string
		ResponseBinding                   policy.Bind
		ResponseOriginal, SourceBytes     []byte
		Source                            struct {
			Resource open.LegacyGrantRefV1
			Fields   []string
			Label    string
			Binding  policy.Bind
		}
	}
	if uniqueServiceJSON(raw) != nil {
		return ErrBinding
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&wire) != nil {
		return ErrBinding
	}
	*r = TaskResourceResult{OperationID: wire.OperationID, RemoteRef: wire.RemoteRef, AuthScope: wire.AuthScope, ResponseBinding: wire.ResponseBinding, ResponseOriginal: bytes.Clone(wire.ResponseOriginal), SourceBytes: bytes.Clone(wire.SourceBytes), Source: policy.Source{Resource: policy.Ref{Realm: wire.Source.Resource.Realm, Tenant: wire.Source.Resource.Tenant, Kind: wire.Source.Resource.Kind, ID: wire.Source.Resource.ID, Revision: wire.Source.Resource.Rev}, Fields: append([]string(nil), wire.Source.Fields...), Label: wire.Source.Label, Binding: wire.Source.Binding}}
	return nil
}
