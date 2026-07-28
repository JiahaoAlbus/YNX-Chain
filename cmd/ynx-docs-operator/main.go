package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
)

func main() {
	os.Exit(run(context.Background(), os.Args[1:], os.Stdout, os.Stderr))
}

func run(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		printUsage(stderr)
		return 2
	}
	switch args[0] {
	case "backup":
		return runBackup(ctx, args[1:], stdout, stderr)
	case "restore":
		return runRestore(ctx, args[1:], stdout, stderr)
	case "help", "-h", "--help":
		printUsage(stdout)
		return 0
	default:
		fmt.Fprintf(stderr, "unknown command %q\n", args[0])
		printUsage(stderr)
		return 2
	}
}

func runBackup(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("backup", flag.ContinueOnError)
	flags.SetOutput(stderr)
	statePath := flags.String("state", "", "path to the persisted Docs/Cloud state file")
	objectDir := flags.String("objects", "", "path to the local content-addressed object directory")
	outDir := flags.String("out", "", "new destination directory for the immutable backup")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "backup does not accept positional arguments")
		return 2
	}
	if err := requirePaths(map[string]string{"state": *statePath, "objects": *objectDir, "out": *outDir}); err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	inside, err := pathInside(*statePath, *objectDir)
	if err != nil {
		fmt.Fprintf(stderr, "resolve backup paths: %v\n", err)
		return 1
	}
	if inside {
		fmt.Fprintln(stderr, "source state must not be inside the source object directory")
		return 2
	}
	inside, err = pathInside(*outDir, *objectDir)
	if err != nil {
		fmt.Fprintf(stderr, "resolve backup paths: %v\n", err)
		return 1
	}
	if inside {
		fmt.Fprintln(stderr, "backup destination must not be inside the source object directory")
		return 2
	}
	manifest, err := cloud.CreateOfflineBackup(ctx, cloud.Config{StatePath: *statePath, ObjectDir: *objectDir}, *outDir)
	if err != nil {
		fmt.Fprintf(stderr, "backup failed: %v\n", err)
		return 1
	}
	if err := writeJSON(stdout, manifest); err != nil {
		fmt.Fprintf(stderr, "encode backup result: %v\n", err)
		return 1
	}
	return 0
}

func runRestore(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("restore", flag.ContinueOnError)
	flags.SetOutput(stderr)
	backupDir := flags.String("backup", "", "path to a YNX Docs backup directory")
	statePath := flags.String("state", "", "new path for the restored state file")
	objectDir := flags.String("objects", "", "new path for restored content-addressed objects")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "restore does not accept positional arguments")
		return 2
	}
	if err := requirePaths(map[string]string{"backup": *backupDir, "state": *statePath, "objects": *objectDir}); err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	inside, err := pathInside(*statePath, *backupDir)
	if err != nil {
		fmt.Fprintf(stderr, "resolve restore paths: %v\n", err)
		return 1
	}
	if inside {
		fmt.Fprintln(stderr, "restored state must not be written inside the backup directory")
		return 2
	}
	inside, err = pathInside(*objectDir, *backupDir)
	if err != nil {
		fmt.Fprintf(stderr, "resolve restore paths: %v\n", err)
		return 1
	}
	if inside {
		fmt.Fprintln(stderr, "restored objects must not be written inside the backup directory")
		return 2
	}
	inside, err = pathInside(*statePath, *objectDir)
	if err != nil {
		fmt.Fprintf(stderr, "resolve restore paths: %v\n", err)
		return 1
	}
	if inside {
		fmt.Fprintln(stderr, "restored state must not be written inside the restored object directory")
		return 2
	}
	_, report, err := cloud.RestoreBackup(ctx, *backupDir, cloud.Config{StatePath: *statePath, ObjectDir: *objectDir})
	if err != nil {
		fmt.Fprintf(stderr, "restore failed: %v\n", err)
		return 1
	}
	if err := writeJSON(stdout, report); err != nil {
		fmt.Fprintf(stderr, "encode restore result: %v\n", err)
		return 1
	}
	return 0
}

func requirePaths(values map[string]string) error {
	missing := make([]string, 0, len(values))
	for name, value := range values {
		if strings.TrimSpace(value) == "" {
			missing = append(missing, "--"+name)
		}
	}
	if len(missing) == 0 {
		return nil
	}
	return fmt.Errorf("required flags missing: %s", strings.Join(missing, ", "))
}

func pathInside(candidate, parent string) (bool, error) {
	candidatePath, err := canonicalPath(candidate)
	if err != nil {
		return false, err
	}
	parentPath, err := canonicalPath(parent)
	if err != nil {
		return false, err
	}
	relative, err := filepath.Rel(parentPath, candidatePath)
	if err != nil {
		return false, err
	}
	return relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))), nil
}

func canonicalPath(path string) (string, error) {
	absolute, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return "", err
	}
	current := absolute
	suffix := []string{}
	for {
		resolved, err := filepath.EvalSymlinks(current)
		if err == nil {
			parts := append([]string{resolved}, reverseStrings(suffix)...)
			return filepath.Join(parts...), nil
		}
		if !os.IsNotExist(err) {
			return "", err
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", err
		}
		suffix = append(suffix, filepath.Base(current))
		current = parent
	}
}

func reverseStrings(values []string) []string {
	reversed := make([]string, len(values))
	for index := range values {
		reversed[len(values)-1-index] = values[index]
	}
	return reversed
}

func writeJSON(writer io.Writer, value any) error {
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func printUsage(writer io.Writer) {
	_, _ = io.WriteString(writer, `YNX Docs operator

Usage:
  ynx-docs-operator backup  --state <state.json> --objects <object-dir> --out <new-backup-dir>
  ynx-docs-operator restore --backup <backup-dir> --state <new-state.json> --objects <new-object-dir>

Safety:
  backup is read-only against the source state and refuses broad source permissions;
  restore verifies manifest, state, object hashes and permissions before writing;
  restore never overwrites an existing state file or local object directory;
  sessions, nonces and presence are not restored.
`)
}
