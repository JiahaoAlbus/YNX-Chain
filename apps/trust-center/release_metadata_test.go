package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

type trustProductRelease struct {
	SourceCommit string `json:"sourceCommit"`
	States       struct {
		IntegratedCentral bool `json:"integratedCentral"`
		DeployedPublic    bool `json:"deployedPublic"`
		DownloadHosted    bool `json:"downloadHosted"`
		ProductionSigned  bool `json:"productionSigned"`
	} `json:"states"`
	Release struct {
		Tag          string `json:"tag"`
		SourceCommit string `json:"sourceCommit"`
		Prerelease   bool   `json:"prerelease"`
		Artifact     struct {
			Name   string `json:"name"`
			SHA256 string `json:"sha256"`
			Bytes  int64  `json:"bytes"`
			Hosted bool   `json:"hosted"`
		} `json:"artifact"`
	} `json:"release"`
}

type trustPublicMetadata struct {
	Product struct {
		SourceCommit string `json:"sourceCommit"`
	} `json:"product"`
	Downloads []struct {
		Release      string `json:"release"`
		URL          string `json:"url"`
		SHA256       string `json:"sha256"`
		Bytes        int64  `json:"bytes"`
		SourceCommit string `json:"sourceCommit"`
	} `json:"downloads"`
}

func TestPublishedPreviewMetadataIsSourceAndArtifactBound(t *testing.T) {
	var release trustProductRelease
	readJSONFixture(t, "../../product-release.json", &release)
	var metadata trustPublicMetadata
	readJSONFixture(t, "../../public-product-metadata.json", &metadata)
	if len(metadata.Downloads) != 1 {
		t.Fatalf("downloads=%d want=1", len(metadata.Downloads))
	}
	download := metadata.Downloads[0]
	if release.SourceCommit != release.Release.SourceCommit || release.SourceCommit != metadata.Product.SourceCommit || release.SourceCommit != download.SourceCommit {
		t.Fatalf("source commits disagree: release=%s artifact=%s metadata=%s download=%s", release.SourceCommit, release.Release.SourceCommit, metadata.Product.SourceCommit, download.SourceCommit)
	}
	if !release.Release.Prerelease || !release.Release.Artifact.Hosted || !release.States.DownloadHosted {
		t.Fatal("published Testnet preview is not consistently marked prerelease and hosted")
	}
	if release.States.IntegratedCentral || release.States.DeployedPublic || release.States.ProductionSigned {
		t.Fatal("hosted preview metadata overclaims central, public Web, or production-signing state")
	}
	if download.Release != release.Release.Tag || download.SHA256 != release.Release.Artifact.SHA256 || download.Bytes != release.Release.Artifact.Bytes {
		t.Fatal("download metadata does not match the release artifact")
	}
	expectedURL := "https://github.com/JiahaoAlbus/YNX-Chain/releases/download/" + release.Release.Tag + "/" + release.Release.Artifact.Name
	if download.URL != expectedURL {
		t.Fatalf("download URL=%q want=%q", download.URL, expectedURL)
	}
}

func TestUIDesignAuditBindsRetainedScreenshots(t *testing.T) {
	audit, err := os.ReadFile("../../UI_DESIGN_AUDIT.md")
	if err != nil {
		t.Fatal(err)
	}
	for _, fixture := range []struct {
		path   string
		digest string
	}{
		{"../../docs/handoffs/evidence/trust-center-desktop.png", "27f4af8040a22712c23b132a2a3cc2fe9afcc3709f011712666248e1b5373ea3"},
		{"../../docs/handoffs/evidence/trust-center-mobile.png", "6ab17c41b1b3637aadd7c797d761b8b5c5b2f3f728a21af9dc2896451d78838e"},
	} {
		raw, err := os.ReadFile(fixture.path)
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(raw)
		if got := hex.EncodeToString(sum[:]); got != fixture.digest {
			t.Fatalf("%s sha256=%s want=%s", fixture.path, got, fixture.digest)
		}
		if !strings.Contains(string(audit), fixture.digest) {
			t.Fatalf("UI audit does not bind %s", fixture.digest)
		}
	}
}

func readJSONFixture(t *testing.T, path string, out any) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatal(err)
	}
}
