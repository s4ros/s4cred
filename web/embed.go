package web

import "embed"

// Files contains the self-contained browser application.
//
//go:embed index.html app.js style.css
var Files embed.FS
