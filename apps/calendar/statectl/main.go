package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	calendarservice "github.com/JiahaoAlbus/YNX-Chain/internal/calendar"
)

const maxBackupBytes = 64 << 20

func main() {
	if len(os.Args) < 2 {
		fatal(errors.New("usage: ynx-calendar-state backup|restore"))
	}
	switch os.Args[1] {
	case "backup":
		backup(os.Args[2:])
	case "restore":
		restore(os.Args[2:])
	default:
		fatal(fmt.Errorf("unknown operation %q", os.Args[1]))
	}
}

func backup(args []string) {
	flags := flag.NewFlagSet("backup", flag.ExitOnError)
	dataDir := flags.String("data-dir", "./var/calendar", "Calendar data directory")
	output := flags.String("output", "", "new backup file path")
	_ = flags.Parse(args)
	if *output == "" {
		fatal(errors.New("backup --output is required"))
	}
	store, err := calendarservice.NewStore(filepath.Join(*dataDir, "state.json"))
	fatal(err)
	body, err := store.CreateBackupAt(time.Now())
	fatal(err)
	file, err := os.OpenFile(*output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	fatal(err)
	if _, err = file.Write(body); err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	fatal(err)
	printJSON(map[string]any{"operation": "backup", "productId": calendarservice.ProductID, "output": *output, "bytes": len(body)})
}

func restore(args []string) {
	flags := flag.NewFlagSet("restore", flag.ExitOnError)
	dataDir := flags.String("data-dir", "./var/calendar", "live Calendar data directory")
	input := flags.String("input", "", "authenticated backup file path")
	restoreRoot := flags.String("restore-root", "", "isolated restore root")
	target := flags.String("target", "", "relative target path inside restore root")
	maxAge := flags.Duration("max-age", 30*24*time.Hour, "maximum accepted backup age")
	_ = flags.Parse(args)
	if *input == "" || *restoreRoot == "" || *target == "" {
		fatal(errors.New("restore --input, --restore-root and --target are required"))
	}
	info, err := os.Stat(*input)
	fatal(err)
	if info.Size() > maxBackupBytes {
		fatal(errors.New("Calendar backup exceeds 64 MiB limit"))
	}
	body, err := os.ReadFile(*input)
	fatal(err)
	store, err := calendarservice.NewStore(filepath.Join(*dataDir, "state.json"))
	fatal(err)
	result, err := store.RestoreBackupTo(*restoreRoot, *target, body, time.Now(), *maxAge)
	fatal(err)
	printJSON(map[string]any{"operation": "restore", "result": result, "liveStoreModified": false})
}

func printJSON(value any) {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	fatal(encoder.Encode(value))
}

func fatal(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
