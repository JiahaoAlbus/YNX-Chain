package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestPackagedLayouts(t *testing.T) {
	quantd, web, root := layout("darwin", "/Applications/YNX Quant Lab.app/Contents/MacOS")
	if !strings.HasSuffix(quantd, filepath.Join("MacOS", "ynx-quantd")) || !strings.HasSuffix(web, filepath.Join("MacOS", "ynx-quant-web")) || !strings.HasSuffix(root, filepath.Join("Resources", "web")) {
		t.Fatalf("darwin layout: %s %s %s", quantd, web, root)
	}
	quantd, web, root = layout("windows", `C:\YNX Quant Lab`)
	if filepath.Ext(quantd) != ".exe" || filepath.Ext(web) != ".exe" || !strings.HasSuffix(root, "web") {
		t.Fatalf("windows layout: %s %s %s", quantd, web, root)
	}
}
