package cloud

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
)

// Only multipart transport is admitted by the PUBLIC authority fixture. This
// tests original bytes and finite caps, not a real signature/resource approval.
func TestIDEDeploymentApprovalTransportBound(t *testing.T) {
	for _, size := range []int{160000, developerauthority.PublicationEnvelopeLimit, developerauthority.PublicationEnvelopeLimit + 1} {
		t.Run(strconv.Itoa(size), func(t *testing.T) {
			_, _, executor, handler := publicIDEFixture(t)
			artifact := []byte("console.log('PUBLIC');\n")
			manifest, err := json.Marshal(IDEArtifactBinding{ProjectID: "PUBLIC_PROJECT", Version: "1", ContentDigest: productHash(artifact), PublishPurpose: "deploy", TargetEnvironment: "PUBLIC_ENV", ByteSize: int64(len(artifact))})
			if err != nil {
				t.Fatal(err)
			}
			approval := []byte(strings.Repeat("P", size))
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			for _, part := range []struct {
				name string
				raw  []byte
			}{{"manifest", manifest}, {"approval", approval}, {"artifact", artifact}} {
				field, err := writer.CreateFormField(part.name)
				if err != nil {
					t.Fatal(err)
				}
				if _, err = field.Write(part.raw); err != nil {
					t.Fatal(err)
				}
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest("POST", "/api/v1/ide/deployments", &body)
			r.Header.Set("Content-Type", writer.FormDataContentType())
			r.Header.Set("Idempotency-Key", "PUBLIC_bound_request_123456")
			out := httptest.NewRecorder()
			handler.ServeHTTP(out, r)
			if size > developerauthority.PublicationEnvelopeLimit {
				if out.Code != 400 || executor.applies != 0 {
					t.Fatal("oversize approval dispatched", out.Code, executor.applies)
				}
				return
			}
			if out.Code != 201 || executor.applies != 1 {
				t.Fatal("bounded approval not transported", out.Code, out.Body.String())
			}
			var op IDEDeploymentOperation
			if err := json.Unmarshal(out.Body.Bytes(), &op); err != nil {
				t.Fatal(err)
			}
			if op.ApprovalSHA256 != productHash(approval) {
				t.Fatal("original approval bytes changed")
			}
		})
	}
}
