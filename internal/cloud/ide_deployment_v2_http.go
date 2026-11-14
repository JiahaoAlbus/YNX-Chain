package cloud

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime"
	mimeMultipart "mime/multipart"
	"net/http"

	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
)

func (s *Server) EnableIDEDeploymentV2DATA(codec *IDEDeploymentV2Codec) error {
	if s.ideDeployments == nil || codec == nil || s.ideDeployments.v2Codec != nil {
		return ErrIDEDeploymentV2DATAUnavailable
	}
	if err := s.ideDeployments.authority.AssertCurrent(context.Background()); err != nil {
		return err
	}
	s.ideDeployments.v2Codec = codec
	return nil
}

// Same original deployment entry and identity. This consumes the real V2 DATA
// codec, but NEVER routes a V2 payload into ARTIFACT-RELEASE or the legacy
// six-field verifier. The genuine Auth V2 signature/Source ABI is not supplied;
// until it is, even valid DATA cannot claim a journal slot, execute or charge.
func (s *Server) ideDeploymentV2DATA(w http.ResponseWriter, r *http.Request, d *ideDeploymentService, principal string) {
	keys := r.Header.Values("Idempotency-Key")
	if len(keys) != 1 || !productWriteKey.MatchString(keys[0]) {
		productReadFailure(w, 400, "IDEMPOTENCY_KEY_REQUIRED")
		return
	}
	revisions := r.Header.Values("X-Expected-Deployment-Revision")
	if len(revisions) != 1 {
		productReadFailure(w, 428, "IDE_DEPLOYMENT_SLOT_REVISION_REQUIRED")
		return
	}
	if n, err := ideSlotNumber(revisions[0]); err != nil || n == ^uint64(0) {
		productReadFailure(w, 400, "IDE_DEPLOYMENT_SLOT_REVISION_INVALID")
		return
	}
	targets := r.Header.Values("X-Rollback-To")
	if len(targets) > 1 || len(targets) == 1 && (!productWriteKey.MatchString(targets[0]) || targets[0] == keys[0]) {
		productReadFailure(w, 400, "IDE_DEPLOYMENT_ROLLBACK_SELECTION_INVALID")
		return
	}
	if d.v2Codec == nil {
		productReadFailure(w, 503, "IDE_DEPLOYMENT_V2_DATA_UNAVAILABLE")
		return
	}
	var multipart *mimeMultipart.Reader
	var err error
	closeBody := func() error { return nil }
	if d.v2Authority != nil {
		borrower, ok := d.v2Authority.(IDEDeploymentV2BodyAuthority)
		if !ok {
			productReadFailure(w, 503, "IDE_DEPLOYMENT_V2_ORIGINAL_REQUEST_UNAVAILABLE")
			return
		}
		held, borrowErr := borrower.BorrowOriginalBodyV5(r.Context(), r)
		if held != nil {
			closed := false
			var first error
			closeBody = func() error {
				if !closed {
					closed = true
					first = held.Close()
				}
				return first
			}
			defer func() { _ = closeBody() }()
		}
		if borrowErr != nil || held == nil {
			productReadFailure(w, 503, "IDE_DEPLOYMENT_V2_ORIGINAL_REQUEST_UNAVAILABLE")
			return
		}
		kind, params, parseErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if parseErr != nil || kind != "multipart/form-data" || params["boundary"] == "" {
			productReadFailure(w, 400, "IDE_DEPLOYMENT_MULTIPART_REQUIRED")
			return
		}
		// SAME already-authenticated request; the Source's held immutable reader
		// is consumed directly. Do not replace Body/clone/reopen or re-auth each
		// chunk. Explicit current/permit/final fences still guard all effects.
		multipart = mimeMultipart.NewReader(held, params["boundary"])
	} else {
		// DATA preflight while no V2 effect authority is installed.
		r.Body = http.MaxBytesReader(w, r.Body, MaxMultipartBytes+developerauthority.PublicationEnvelopeLimit+(128<<10))
		multipart, err = r.MultipartReader()
	}
	if err != nil {
		productReadFailure(w, 400, "IDE_DEPLOYMENT_MULTIPART_REQUIRED")
		return
	}
	read := func(name string, max int64) ([]byte, error) {
		part, err := multipart.NextPart()
		if err != nil {
			return nil, err
		}
		if part.FormName() != name {
			return nil, ErrInvalid
		}
		body, err := readIDEArtifactBounded(r.Context(), part, max)
		if err != nil {
			return nil, err
		}
		if err = part.Close(); err != nil {
			return nil, err
		}
		return body, nil
	}
	payload, err := read("manifest", 16<<10)
	if err != nil {
		productReadFailure(w, 400, "IDE_DEPLOYMENT_V2_MANIFEST_REJECTED")
		return
	}
	approval, err := read("approval", developerauthority.PublicationEnvelopeLimit)
	if err != nil || len(approval) == 0 {
		productReadFailure(w, 400, "IDE_DEPLOYMENT_V2_APPROVAL_REQUIRED")
		return
	}
	part, err := multipart.NextPart()
	if err != nil || part.FormName() != "artifact" {
		productReadFailure(w, 400, "IDE_DEPLOYMENT_ARTIFACT_REQUIRED")
		return
	}
	artifact, err := ReadIDEDeploymentArtifactV2(r.Context(), d.v2Codec, bytes.NewReader(payload), part, nil, MaxMultipartBytes)
	if err != nil {
		status := 400
		code := "IDE_DEPLOYMENT_V2_DATA_REJECTED"
		if errors.Is(err, ErrIDEDeploymentV2DATAUnavailable) {
			status = 503
			code = "IDE_DEPLOYMENT_V2_DATA_UNAVAILABLE"
		}
		productReadFailure(w, status, code)
		return
	}
	if err = part.Close(); err != nil {
		productReadFailure(w, 400, "IDE_DEPLOYMENT_ARTIFACT_REJECTED")
		return
	}
	if _, err = multipart.NextPart(); err != io.EOF {
		productReadFailure(w, 400, "IDE_DEPLOYMENT_EXTRA_PART")
		return
	}
	if closeBody() != nil {
		productReadFailure(w, 503, "IDE_DEPLOYMENT_V2_ORIGINAL_REQUEST_UNAVAILABLE")
		return
	}
	if r.Context().Err() != nil || d.authority.AssertCurrent(r.Context()) != nil {
		productReadFailure(w, 403, "IDE_DEPLOYMENT_CURRENT_UNAVAILABLE")
		return
	}
	s.finishIDEDeploymentV2(w, r, d, principal, artifact, approval, keys[0], revisions[0], targets)
}
