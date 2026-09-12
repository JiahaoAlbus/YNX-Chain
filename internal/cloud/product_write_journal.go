package cloud

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
)

// The journal deliberately keeps uncertain writes pending after a crash. It
// never repeats an operation whose commit status cannot be established. An
// operator must reconcile that case against the object/version state.
type productWriteJournal struct{ root string }

type productWriteReceipt struct {
	Version     int    `json:"version"`
	Digest      string `json:"digest"`
	State       string `json:"state"`
	Status      int    `json:"status,omitempty"`
	ContentType string `json:"contentType,omitempty"`
	Body        []byte `json:"body,omitempty"`
}

var productWriteKey = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)

func newProductWriteJournal(root string) (*productWriteJournal, error) {
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("v2 idempotency directory must be private")
	}
	return &productWriteJournal{root: root}, nil
}

func productHash(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

type productWriteResponse struct {
	header   http.Header
	status   int
	body     bytes.Buffer
	overflow bool
}

func (w *productWriteResponse) Header() http.Header { return w.header }
func (w *productWriteResponse) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}
func (w *productWriteResponse) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	if w.body.Len()+len(b) > 1<<20 {
		w.overflow = true
		return len(b), nil
	}
	return w.body.Write(b)
}

func replayProductWrite(w http.ResponseWriter, receipt productWriteReceipt, replay bool) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", receipt.ContentType)
	if replay {
		w.Header().Set("Idempotency-Replayed", "true")
	}
	w.WriteHeader(receipt.Status)
	_, _ = w.Write(receipt.Body)
}

func (j *productWriteJournal) serve(w http.ResponseWriter, r *http.Request, actor Session, next authed) {
	if j == nil {
		productReadFailure(w, 503, "WRITE_JOURNAL_UNAVAILABLE")
		return
	}
	keys := r.Header.Values("Idempotency-Key")
	if len(keys) != 1 || !productWriteKey.MatchString(keys[0]) {
		productReadFailure(w, 400, "IDEMPOTENCY_KEY_REQUIRED")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxUploadBytes*2+4096))
	if err != nil {
		productReadFailure(w, 413, "WRITE_BODY_TOO_LARGE")
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	digest := productHash(append([]byte(r.Method+"\x00"+r.URL.RequestURI()+"\x00"+r.Header.Get("Content-Type")+"\x00"), body...))
	name := productHash([]byte(actor.Product+"\x00"+actor.Account+"\x00"+keys[0])) + ".json"
	file := filepath.Join(j.root, name)
	receipt := productWriteReceipt{Version: 1, Digest: digest, State: "pending"}
	initial, _ := json.Marshal(receipt)
	f, err := os.OpenFile(file, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if errors.Is(err, os.ErrExist) {
		raw, readErr := os.ReadFile(file)
		if readErr != nil || json.Unmarshal(raw, &receipt) != nil || receipt.Version != 1 {
			productReadFailure(w, 503, "WRITE_JOURNAL_UNAVAILABLE")
			return
		}
		if receipt.Digest != digest {
			productReadFailure(w, 409, "IDEMPOTENCY_KEY_CONFLICT")
			return
		}
		if receipt.State != "complete" {
			productReadFailure(w, 409, "WRITE_OUTCOME_UNCERTAIN")
			return
		}
		if receipt.Status < 200 || receipt.Status >= 500 {
			productReadFailure(w, 503, "WRITE_JOURNAL_UNAVAILABLE")
			return
		}
		replayProductWrite(w, receipt, true)
		return
	}
	if err != nil {
		productReadFailure(w, 503, "WRITE_JOURNAL_UNAVAILABLE")
		return
	}
	_, err = f.Write(initial)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil || closeErr != nil || socialSync(j.root) != nil {
		productReadFailure(w, 503, "WRITE_JOURNAL_UNAVAILABLE")
		return
	}
	response := &productWriteResponse{header: make(http.Header)}
	next(response, r, actor)
	if response.status == 0 {
		response.status = http.StatusOK
	}
	if response.overflow {
		productReadFailure(w, 503, "WRITE_OUTCOME_UNCERTAIN")
		return
	}
	receipt.Status = response.status
	receipt.ContentType = response.header.Get("Content-Type")
	receipt.Body = response.body.Bytes()
	if response.status >= 500 {
		// Preserve pending state: a failed persistence acknowledgment is not
		// evidence that the business operation had no effect.
		replayProductWrite(w, receipt, false)
		return
	}
	receipt.State = "complete"
	encoded, err := json.Marshal(receipt)
	if err != nil || socialAtomic(file, encoded) != nil {
		productReadFailure(w, 503, "WRITE_OUTCOME_UNCERTAIN")
		return
	}
	replayProductWrite(w, receipt, false)
}
