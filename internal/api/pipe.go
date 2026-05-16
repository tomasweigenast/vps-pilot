package api

import "io"

func newPipe() (*io.PipeReader, *io.PipeWriter) {
	return io.Pipe()
}
