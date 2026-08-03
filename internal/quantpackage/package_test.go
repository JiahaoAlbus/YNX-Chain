package quantpackage

import (
	"crypto/ed25519"
	"crypto/rand"
	"strings"
	"testing"
)

func TestSignaturePermissionsLimitsAndDependencyAllowlist(t *testing.T) {
	publicKey, privateKey, _ := ed25519.GenerateKey(rand.Reader)
	artifact := strings.Repeat("a", 64)
	source := "quant://built-in/ma\ncommit"
	dependencyHash := strings.Repeat("b", 64)
	manifest := Manifest{Schema: 1, PackageID: "signed-ma", Version: "1.0.0", Runtime: "ynx-built-in-ma-v1", SourceSHA256: HashString(source), ArtifactSHA256: artifact, Dependencies: []Dependency{{Name: "ynx-indicators", Version: "1.0.0", SHA256: dependencyHash, License: "Apache-2.0"}}, Limits: Limits{CPUMilliseconds: 5_000, MemoryBytes: 128 << 20, WallMilliseconds: 10_000, MaxInputBars: 1_000}, DeterministicClock: true, CheckpointRecovery: true, Scan: ScanEvidence{SecretScanPassed: true, MalwareScanPassed: true, ScannerVersion: "scanner-1", EvidenceSHA256: strings.Repeat("c", 64)}, SignerKeyID: "operator-1"}
	manifest = Sign(manifest, privateKey)
	verifier := Verifier{TrustedSigners: map[string]ed25519.PublicKey{"operator-1": publicKey}, DependencyAllowlist: map[string]map[string]string{"ynx-indicators": {"1.0.0": dependencyHash}}}
	if err := verifier.Verify(manifest, artifact, source, 100); err != nil {
		t.Fatal(err)
	}

	tampered := manifest
	tampered.Limits.MemoryBytes = 256 << 20
	if err := verifier.Verify(tampered, artifact, source, 100); err != ErrInvalidPackage {
		t.Fatalf("signature tamper=%v", err)
	}
	forbidden := manifest
	forbidden.Permissions.ArbitraryNetwork = true
	forbidden = Sign(forbidden, privateKey)
	if err := verifier.Verify(forbidden, artifact, source, 100); err != ErrInvalidPackage {
		t.Fatalf("network permission=%v", err)
	}
	wrongDependency := manifest
	wrongDependency.Dependencies[0].SHA256 = strings.Repeat("d", 64)
	wrongDependency = Sign(wrongDependency, privateKey)
	if err := verifier.Verify(wrongDependency, artifact, source, 100); err != ErrInvalidPackage {
		t.Fatalf("dependency=%v", err)
	}
}
