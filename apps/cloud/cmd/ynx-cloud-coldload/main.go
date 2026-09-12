// ynx-cloud-coldload exercises a candidate against an operator-provided offline
// snapshot, never against the running service directory. No network verifier,
// listener, background worker, account request or signing operation is enabled.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
)

func run() error {
	snapshot := flag.String("snapshot", "", "operator-created, quiesced offline Cloud data snapshot; never a live data directory")
	output := flag.String("output", "", "new directory for verified backup and disposable cold-loaded copy")
	flag.Parse()
	if *snapshot == "" || *output == "" {
		return fmt.Errorf("-snapshot and -output are required")
	}
	source, err := filepath.Abs(*snapshot)
	if err != nil {
		return err
	}
	destination, err := filepath.Abs(*output)
	if err != nil {
		return err
	}
	source, err = filepath.EvalSymlinks(source)
	if err != nil {
		return err
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(destination))
	if err != nil {
		return err
	}
	destination = filepath.Join(parent, filepath.Base(destination))
	// A nested output would contaminate a recursive snapshot backup.
	for p := destination; ; p = filepath.Dir(p) {
		if p == source {
			return fmt.Errorf("output must be outside the snapshot directory")
		}
		if filepath.Dir(p) == p {
			break
		}
	}
	if err := os.Mkdir(destination, 0700); err != nil {
		return err
	}
	backup := filepath.Join(destination, "verified-backup")
	working := filepath.Join(destination, "cold-copy")
	manifest, err := cloud.CreateRecoveryBackup(source, backup, "operator-provided-offline-snapshot", time.Now())
	if err != nil {
		return fmt.Errorf("snapshot backup rejected: %w", err)
	}
	if _, err := cloud.RestoreRecoveryBackup(backup, working); err != nil {
		return fmt.Errorf("snapshot restore rejected: %w", err)
	}
	service, err := cloud.New(cloud.Config{
		StatePath: filepath.Join(working, "state.json"), ObjectDir: filepath.Join(working, "objects"),
		WalletVerifier: cloud.UnavailableWalletVerifier{}, AIProvider: cloud.UnavailableAIProvider{},
		ObjectStore: cloud.LocalObjectStore{Root: filepath.Join(working, "objects")},
	})
	if err != nil {
		return fmt.Errorf("candidate cold-load rejected: %w", err)
	}
	// Do not enable v2 or initialize new journals here: this checks the restored
	// data, not a fabricated empty service configuration.
	return json.NewEncoder(os.Stdout).Encode(map[string]any{
		"coldLoad": "passed", "snapshotSource": "operator-provided-offline-copy", "backupFiles": len(manifest.Files),
		"liveness": service.Liveness(), "outputDirectory": destination,
		"publicAcceptance": false, "businessAcceptance": false, "remoteObjectStoreVerified": false,
		"boundary": "local snapshot recovery and service initialization only; not full Docs feature parity or provider blob acceptance",
	})
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
