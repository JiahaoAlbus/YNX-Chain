package musicapp

import (
	"embed"
	"io/fs"
)

//go:generate node scripts/build-current-web-sdk.mjs
//go:embed web/*
var content embed.FS

func Web() fs.FS { web, _ := fs.Sub(content, "web"); return web }
