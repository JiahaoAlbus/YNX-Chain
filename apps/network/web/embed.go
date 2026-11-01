// Package web embeds the independent Network PWA; it never caches helper APIs.
package web

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed index.html app.js style.css manifest.webmanifest sw.js icon.svg i18n.js overview.js shell.js native-bridge.js brand.png app-icon.png icons/*.svg icons/LICENSE.txt icons/SOURCE.json
var assets embed.FS
var handler = http.FileServer(http.FS(assets))

func Handler() http.Handler { return handler }
func Assets() fs.FS         { return assets }
