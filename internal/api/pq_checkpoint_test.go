package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPQAuthorizationCheckpointDoesNotTurnUnknownIntoAuthority(t *testing.T) {
	f := newAPIPQFixture(t)
	read := func(status, algorithm string) {
		t.Helper()
		w := apiPQRequest(t, f.h, http.MethodGet, "/accounts/"+f.owner+"/authorization", "", nil, http.StatusOK)
		var response struct {
			CheckpointStatus, CheckpointIntegrity         string
			CommittedBlockHash, CommittedAlgorithmVersion string
			RecordsComplete                               bool
		}
		apiPQDecode(t, w, &response)
		if response.CheckpointStatus != status || response.CommittedAlgorithmVersion != algorithm || !response.RecordsComplete || len(response.CommittedBlockHash) != 64 || strings.HasPrefix(response.CommittedBlockHash, "0x") || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("authorization query mislabeled producer checkpoint")
		}
		if (status == "durable") != (len(response.CheckpointIntegrity) == 64) {
			t.Fatal("uncertain query exposed a confirmed checkpoint integrity")
		}
	}
	read("durable", "legacy")
	marker := filepath.Join(f.dir, "devnet-state.integrity-version.tmp")
	apiPQMust(t, os.Mkdir(marker, 0700))
	apiPQMust(t, os.WriteFile(filepath.Join(marker, "blocked"), []byte("fixture"), 0600))
	wire := f.migration(t)
	path := "/accounts/" + f.owner + "/authorization/migrate"
	apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", wire, http.StatusServiceUnavailable)
	read("uncertain", "legacy")
	apiPQMust(t, os.RemoveAll(marker))
	apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", wire, http.StatusOK)
	read("durable", "legacy")
	f.d.ProduceBlock()
	read("durable", "legacy")
	f.d.ProduceBlock()
	read("durable", "YNX-BATCH/v0.1")
}
