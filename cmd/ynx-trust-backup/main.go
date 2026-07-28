package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/trustproduct"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		printUsage(stderr)
		return 2
	}
	if args[0] == "version" {
		if len(args) != 1 {
			fmt.Fprintln(stderr, "version does not accept arguments")
			return 2
		}
		encoder := json.NewEncoder(stdout)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(currentBuildInfo()); err != nil {
			fmt.Fprintf(stderr, "encode Trust backup build information: %v\n", err)
			return 1
		}
		return 0
	}

	var manifest trustproduct.BackupManifest
	var err error
	switch args[0] {
	case "create":
		manifest, err = createBackup(args[1:], stderr)
	case "restore":
		manifest, err = restoreBackup(args[1:], stderr)
	default:
		fmt.Fprintf(stderr, "unknown Trust backup command %q\n", args[0])
		printUsage(stderr)
		return 2
	}
	if err != nil {
		fmt.Fprintf(stderr, "Trust backup %s failed: %v\n", args[0], err)
		return 1
	}
	encoder := json.NewEncoder(stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(manifest); err != nil {
		fmt.Fprintf(stderr, "encode Trust backup manifest: %v\n", err)
		return 1
	}
	return 0
}

func createBackup(args []string, stderr io.Writer) (trustproduct.BackupManifest, error) {
	flags := flag.NewFlagSet("create", flag.ContinueOnError)
	flags.SetOutput(stderr)
	store := flags.String("store", "", "path to the Trust state file")
	output := flags.String("out", "", "new immutable backup file")
	if err := flags.Parse(args); err != nil {
		return trustproduct.BackupManifest{}, err
	}
	if flags.NArg() != 0 || strings.TrimSpace(*store) == "" || strings.TrimSpace(*output) == "" {
		return trustproduct.BackupManifest{}, errors.New("create requires -store and -out")
	}
	info, err := os.Lstat(*store)
	if err != nil {
		return trustproduct.BackupManifest{}, fmt.Errorf("open live Trust store: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return trustproduct.BackupManifest{}, errors.New("live Trust store must be a regular non-symlink file")
	}
	if info.Mode().Perm() != 0o600 {
		return trustproduct.BackupManifest{}, fmt.Errorf("live Trust store mode must be 0600, got %04o", info.Mode().Perm())
	}
	svc, err := trustproduct.New(trustproduct.Config{StorePath: *store})
	if err != nil {
		return trustproduct.BackupManifest{}, err
	}
	return svc.CreateBackup(*output)
}

func restoreBackup(args []string, stderr io.Writer) (trustproduct.BackupManifest, error) {
	flags := flag.NewFlagSet("restore", flag.ContinueOnError)
	flags.SetOutput(stderr)
	backup := flags.String("backup", "", "verified Trust backup file")
	store := flags.String("store", "", "new Trust state file")
	if err := flags.Parse(args); err != nil {
		return trustproduct.BackupManifest{}, err
	}
	if flags.NArg() != 0 || strings.TrimSpace(*backup) == "" || strings.TrimSpace(*store) == "" {
		return trustproduct.BackupManifest{}, errors.New("restore requires -backup and -store")
	}
	manifest, err := trustproduct.RestoreBackup(*backup, *store)
	if err != nil {
		return trustproduct.BackupManifest{}, err
	}
	if _, err := trustproduct.New(trustproduct.Config{StorePath: *store}); err != nil {
		_ = os.Remove(*store)
		return trustproduct.BackupManifest{}, fmt.Errorf("cold-start restored Trust store: %w", err)
	}
	return manifest, nil
}

func currentBuildInfo() buildinfo.Info {
	return buildinfo.Normalize(buildinfo.Info{
		Commit:    strings.TrimSpace(buildCommit),
		Release:   strings.TrimSpace(buildRelease),
		BuildTime: strings.TrimSpace(buildTime),
	})
}

func printUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  ynx-trust-backup version")
	fmt.Fprintln(w, "  ynx-trust-backup create -store <state.json> -out <backup.json>")
	fmt.Fprintln(w, "  ynx-trust-backup restore -backup <backup.json> -store <new-state.json>")
}
