package api

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	dockerapi "github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
	"github.com/tomasweigenast/vps-manager/internal/docker"
	wslib "github.com/tomasweigenast/vps-manager/internal/ws"
)

// wsMetrics upgrades to WebSocket and subscribes the client to the metrics hub.
func (h *systemHandler) wsMetrics(w http.ResponseWriter, r *http.Request) {
	h.wsHub.Upgrade(w, r)
}

// wsProjectLogs upgrades to WebSocket and streams container logs for a project.
// Query params: tail (default "200"), follow (default "true"), since, until.
func (h *dockerHandler) wsProjectLogs(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	q := r.URL.Query()
	tail := q.Get("tail")
	if tail == "" {
		tail = "200"
	}
	follow := q.Get("follow") != "false"
	opts := docker.LogStreamOptions{
		Tail:   tail,
		Follow: follow,
		Since:  q.Get("since"),
		Until:  q.Get("until"),
	}

	conn, err := wslib.Upgrader().Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// Container names event
	if names := h.manager.GetContainerNames(r.Context(), name); len(names) > 0 {
		b, _ := json.Marshal(wslib.Event{Type: "services", Data: names})
		conn.WriteMessage(websocket.TextMessage, b) //nolint:errcheck
	}

	pr, pw := newPipe()
	defer pw.Close()

	go func() {
		defer pw.Close()
		h.manager.StreamLogs(r.Context(), name, pw, opts) //nolint:errcheck
	}()

	// Read goroutine: required by gorilla/websocket to process control frames
	// (PING, PONG, CLOSE). Without this the browser's close frame is never
	// consumed and it eventually drops the TCP connection.
	go func() {
		defer conn.Close()
		conn.SetReadLimit(512)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	scanner := bufio.NewScanner(pr)
	for scanner.Scan() {
		b, _ := json.Marshal(wslib.Event{Type: "log", Data: scanner.Text()})
		if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
			return
		}
	}
}

// wsProjectStats upgrades to WebSocket and streams per-container CPU/RAM stats.
// One goroutine per container streams Docker stats; a ticker broadcasts aggregated
// results to the client every second.
func (h *dockerHandler) wsProjectStats(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	conn, err := wslib.Upgrader().Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// Send cached snapshot immediately so the client has data before the first tick.
	if cached, ok := h.statsCache.Load(name); ok {
		if b, err := json.Marshal(wslib.Event{Type: "stats", Data: cached}); err == nil {
			conn.WriteMessage(websocket.TextMessage, b) //nolint:errcheck
		}
	}

	refs := h.manager.GetProjectContainerRefs(r.Context(), name)
	if len(refs) == 0 {
		return
	}

	var mu sync.Mutex
	stats := make(map[string]docker.ContainerStat)

	ctx := r.Context()
	dockerCli := h.manager.DockerClient()
	if dockerCli == nil {
		return
	}

	for _, ref := range refs {
		go streamContainerStats(ctx, dockerCli, ref.ID, ref.Name, stats, &mu) //nolint:govet
	}

	// Read goroutine to process control frames.
	go func() {
		defer conn.Close()
		conn.SetReadLimit(512)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			mu.Lock()
			snapshot := make([]docker.ContainerStat, 0, len(stats))
			for _, s := range stats {
				snapshot = append(snapshot, s)
			}
			mu.Unlock()
			if len(snapshot) > 0 {
				h.statsCache.Store(name, snapshot)
			}
			b, _ := json.Marshal(wslib.Event{Type: "stats", Data: snapshot})
			if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
				return
			}
		}
	}
}

func streamContainerStats(ctx context.Context, cli *client.Client, id, name string, stats map[string]docker.ContainerStat, mu *sync.Mutex) {
	res, err := cli.ContainerStats(ctx, id, client.ContainerStatsOptions{Stream: true})
	if err != nil {
		return
	}
	defer res.Body.Close()

	dec := json.NewDecoder(res.Body)
	for {
		var s dockerapi.StatsResponse
		if err := dec.Decode(&s); err != nil {
			return
		}

		cpuDelta := float64(s.CPUStats.CPUUsage.TotalUsage) - float64(s.PreCPUStats.CPUUsage.TotalUsage)
		sysDelta := float64(s.CPUStats.SystemUsage) - float64(s.PreCPUStats.SystemUsage)
		numCPU := float64(s.CPUStats.OnlineCPUs)
		if numCPU == 0 {
			numCPU = 1
		}
		var cpuPercent float64
		if sysDelta > 0 {
			cpuPercent = (cpuDelta / sysDelta) * numCPU * 100
		}

		memUsed := s.MemoryStats.Usage
		// Subtract cache from usage to match Docker Desktop display.
		if cache, ok := s.MemoryStats.Stats["cache"]; ok {
			if memUsed > cache {
				memUsed -= cache
			}
		}

		mu.Lock()
		stats[name] = docker.ContainerStat{
			Name:       name,
			CPUPercent: cpuPercent,
			MemUsed:    memUsed,
			MemLimit:   s.MemoryStats.Limit,
		}
		mu.Unlock()
	}
}

// wsDeployStream upgrades to WebSocket and streams deploy events.
func (h *dockerHandler) wsDeployStream(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	conn, err := wslib.Upgrader().Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	send := func(evt docker.DeployEvent) {
		b, _ := json.Marshal(wslib.Event{Type: string(evt.Type), Data: evt})
		conn.WriteMessage(websocket.TextMessage, b) //nolint:errcheck
	}

	h.manager.DeployStream(r.Context(), name, send) //nolint:errcheck
}

// wsStopStream upgrades to WebSocket and streams stop events.
func (h *dockerHandler) wsStopStream(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	conn, err := wslib.Upgrader().Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	pr, pw := newPipe()
	var stopErr error
	go func() {
		defer pw.Close()
		stopErr = h.manager.StopStream(r.Context(), name, pw)
	}()

	scanner := bufio.NewScanner(pr)
	for scanner.Scan() {
		select {
		case <-r.Context().Done():
			return
		default:
		}
		b, _ := json.Marshal(wslib.Event{Type: "compose", Data: scanner.Text()})
		if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
			return
		}
	}

	evt := docker.DeployEvent{Type: docker.DeployEventDone, Success: stopErr == nil}
	if stopErr != nil {
		evt.Error = stopErr.Error()
	}
	b, _ := json.Marshal(wslib.Event{Type: string(evt.Type), Data: evt})
	conn.WriteMessage(websocket.TextMessage, b) //nolint:errcheck
}

// wsContainerExec upgrades to WebSocket and provides an interactive shell inside a container.
// The client sends UTF-8 text messages (stdin bytes) and JSON resize messages:
//
//	{"type":"resize","cols":N,"rows":N}
//
// The server sends raw terminal output as binary WebSocket messages.
func (h *dockerHandler) wsContainerExec(w http.ResponseWriter, r *http.Request) {
	containerID := chi.URLParam(r, "id")

	cli := h.manager.DockerClient()
	if cli == nil {
		http.Error(w, "docker unavailable", http.StatusServiceUnavailable)
		return
	}

	execRes, err := cli.ExecCreate(r.Context(), containerID, client.ExecCreateOptions{
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
		TTY:          true,
		Cmd:          []string{"/bin/sh"},
	})
	if err != nil {
		// Try bash as fallback
		execRes, err = cli.ExecCreate(r.Context(), containerID, client.ExecCreateOptions{
			AttachStdin:  true,
			AttachStdout: true,
			AttachStderr: true,
			TTY:          true,
			Cmd:          []string{"/bin/bash"},
		})
		if err != nil {
			http.Error(w, "exec create: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	attachRes, err := cli.ExecAttach(r.Context(), execRes.ID, client.ExecAttachOptions{TTY: true})
	if err != nil {
		http.Error(w, "exec attach: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer attachRes.Close()

	conn, err := wslib.Upgrader().Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Docker → WebSocket
	go func() {
		defer cancel()
		buf := make([]byte, 4096)
		for {
			n, err := attachRes.Reader.Read(buf)
			if n > 0 {
				if werr := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); werr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	// WebSocket → Docker (stdin) + resize handling
	type resizeMsg struct {
		Type string `json:"type"`
		Cols uint   `json:"cols"`
		Rows uint   `json:"rows"`
	}
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var rm resizeMsg
		if json.Unmarshal(msg, &rm) == nil && rm.Type == "resize" && rm.Cols > 0 && rm.Rows > 0 {
			cli.ExecResize(ctx, execRes.ID, client.ExecResizeOptions{Height: rm.Rows, Width: rm.Cols}) //nolint:errcheck
			continue
		}
		// Plain text: forward to stdin
		if _, err := attachRes.Conn.Write(msg); err != nil {
			return
		}
	}
}

// wsServerLogs upgrades to WebSocket and streams server log lines.
func (h *logsHandler) wsServerLogs(w http.ResponseWriter, r *http.Request) {
	conn, err := wslib.Upgrader().Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	for _, line := range h.buf.Lines(100) {
		b, _ := json.Marshal(wslib.Event{Type: "log", Data: string(line)})
		if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
			return
		}
	}

	ch := h.buf.Subscribe()
	defer h.buf.Unsubscribe(ch)

	for {
		select {
		case line, ok := <-ch:
			if !ok {
				return
			}
			b, _ := json.Marshal(wslib.Event{Type: "log", Data: string(line)})
			if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
				return
			}
		case <-r.Context().Done():
			return
		}
	}
}
