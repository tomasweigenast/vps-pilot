package api

import "io"

// newSSEPipe returns a read end and a write end backed by io.Pipe.
func newSSEPipe() (*io.PipeReader, *io.PipeWriter) {
	return io.Pipe()
}
