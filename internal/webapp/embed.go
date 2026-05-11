package webapp

import (
	"embed"
	"io/fs"
)

//go:embed dist
var dist embed.FS

// FS returns the embedded web dist as a sub-filesystem rooted at "dist/".
func FS() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic("webapp: dist not embedded: " + err.Error())
	}
	return sub
}
