package logbuffer

import (
	"bytes"
	"sync"
)

const DefaultSize = 500

// RingBuffer is a thread-safe fixed-capacity circular buffer of log lines.
// It implements io.Writer (splitting on newlines) and supports fan-out to subscribers.
type RingBuffer struct {
	mu      sync.RWMutex
	lines   []string
	head    int // next write index
	count   int // number of valid entries (≤ size)
	size    int
	subs    map[chan string]struct{}
	partial bytes.Buffer // accumulates incomplete lines
}

func New(size int) *RingBuffer {
	return &RingBuffer{
		size:  size,
		lines: make([]string, size),
		subs:  make(map[chan string]struct{}),
	}
}

// Write implements io.Writer. Splits p on newlines; each complete line is stored and broadcast.
func (b *RingBuffer) Write(p []byte) (int, error) {
	n := len(p)
	b.mu.Lock()
	defer b.mu.Unlock()

	b.partial.Write(p)
	for {
		data := b.partial.Bytes()
		idx := bytes.IndexByte(data, '\n')
		if idx < 0 {
			break
		}
		line := string(data[:idx])
		remaining := make([]byte, len(data)-idx-1)
		copy(remaining, data[idx+1:])
		b.partial.Reset()
		b.partial.Write(remaining)

		if line == "" {
			continue
		}
		b.storeLocked(line)
	}
	return n, nil
}

func (b *RingBuffer) storeLocked(line string) {
	b.lines[b.head] = line
	b.head = (b.head + 1) % b.size
	if b.count < b.size {
		b.count++
	}
	for ch := range b.subs {
		select {
		case ch <- line:
		default: // drop on slow consumer
		}
	}
}

// Lines returns the last n lines in chronological order.
func (b *RingBuffer) Lines(n int) []string {
	b.mu.RLock()
	defer b.mu.RUnlock()

	if n > b.count {
		n = b.count
	}
	if n == 0 {
		return nil
	}
	out := make([]string, n)
	start := (b.head - n + b.size*2) % b.size
	for i := range n {
		out[i] = b.lines[(start+i)%b.size]
	}
	return out
}

// Subscribe returns a buffered channel that receives new lines as they arrive.
func (b *RingBuffer) Subscribe() chan string {
	ch := make(chan string, 64)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

// Unsubscribe removes and closes a subscriber channel.
func (b *RingBuffer) Unsubscribe(ch chan string) {
	b.mu.Lock()
	delete(b.subs, ch)
	b.mu.Unlock()
	close(ch)
}
