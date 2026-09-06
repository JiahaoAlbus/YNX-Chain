package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/video"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	command := os.Args[1]
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	data := flags.String("data", "", "YNX Video data directory")
	archive := flags.String("archive", "", "backup archive path")
	if err := flags.Parse(os.Args[2:]); err != nil || flags.NArg() != 0 || *data == "" || *archive == "" {
		usage()
		os.Exit(2)
	}
	key := []byte(strings.TrimSpace(os.Getenv("YNX_VIDEO_INTEGRITY_KEY")))
	if len(key) < 32 {
		fatal("YNX_VIDEO_INTEGRITY_KEY must be at least 32 bytes")
	}
	switch command {
	case "backup":
		output, err := os.OpenFile(*archive, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			fatal(err.Error())
		}
		if err = video.CreateBackup(*data, key, output, time.Now()); err != nil {
			_ = output.Close()
			_ = os.Remove(*archive)
			fatal(err.Error())
		}
		if err = output.Sync(); err == nil {
			err = output.Close()
		}
		if err != nil {
			fatal(err.Error())
		}
		fmt.Println("verified backup created")
	case "restore":
		input, err := os.Open(*archive)
		if err != nil {
			fatal(err.Error())
		}
		err = video.RestoreBackup(*data, key, input)
		_ = input.Close()
		if err != nil {
			fatal(err.Error())
		}
		fmt.Println("verified backup restored")
	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: video-recover <backup|restore> -data PATH -archive PATH")
}

func fatal(message string) {
	fmt.Fprintln(os.Stderr, "video-recover:", message)
	os.Exit(1)
}
