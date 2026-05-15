package docker

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/moby/moby/api/pkg/stdcopy"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/jsonstream"
	"github.com/moby/moby/client"
	"github.com/tomasweigenast/vps-manager/internal/db"
)

type ProjectStatus string

const (
	StatusRunning ProjectStatus = "running"
	StatusPartial ProjectStatus = "partial"
	StatusStopped ProjectStatus = "stopped"
)

type Project struct {
	Name       string        `json:"name"`
	Dir        string        `json:"dir"`
	Status     ProjectStatus `json:"status"`
	Containers []Container   `json:"containers"`
	// DB-managed fields (zero if project is filesystem-only)
	HasRecord bool
	EnvVars   map[string]string
}

type Container struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Image  string `json:"image"`
	State  string `json:"state"`
	Status string `json:"status"`
	Ports  string `json:"ports"`
}

type Manager struct {
	projectsDir string
	db          *sql.DB
	docker      *client.Client
}

func NewManager(projectsDir string, database *sql.DB, docker *client.Client) *Manager {
	return &Manager{projectsDir: projectsDir, db: database, docker: docker}
}

// ListProjects returns projects sourced from SQLite (DB is authoritative) merged with
// any filesystem-only projects found in projectsDir. Container state comes from the
// Docker Engine API.
func (m *Manager) ListProjects(ctx context.Context) ([]Project, error) {
	seen := map[string]bool{}
	var projects []Project

	// DB-managed projects first
	if m.db != nil {
		records, err := db.ListProjectRecords(m.db)
		if err != nil {
			slog.Warn("list db projects", "err", err)
		} else {
			for _, rec := range records {
				dir := filepath.Join(m.projectsDir, rec.Name)
				proj, err := m.loadProject(ctx, rec.Name, dir)
				if err != nil {
					proj = Project{Name: rec.Name, Dir: dir, Status: StatusStopped}
				}
				proj.HasRecord = true
				proj.EnvVars = rec.EnvVars
				projects = append(projects, proj)
				seen[rec.Name] = true
			}
		}
	}

	// Filesystem-only projects (no DB record)
	entries, err := os.ReadDir(m.projectsDir)
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("read projects dir: %w", err)
	}
	for _, e := range entries {
		if !e.IsDir() || seen[e.Name()] {
			continue
		}
		dir := filepath.Join(m.projectsDir, e.Name())
		if !hasComposeFile(dir) {
			continue
		}
		proj, err := m.loadProject(ctx, e.Name(), dir)
		if err != nil {
			continue
		}
		projects = append(projects, proj)
	}
	return projects, nil
}

func (m *Manager) GetProject(ctx context.Context, name string) (Project, error) {
	dir := filepath.Join(m.projectsDir, name)
	return m.loadProject(ctx, name, dir)
}

func (m *Manager) loadProject(ctx context.Context, name, dir string) (Project, error) {
	proj := Project{Name: name, Dir: dir}
	if m.docker == nil {
		return proj, nil
	}

	result, err := m.docker.ContainerList(ctx, client.ContainerListOptions{All: true})
	if err != nil {
		slog.Warn("container list failed", "project", name, "err", err)
		return proj, err
	}

	prefix := name + "-"
	running := 0
	for _, c := range result.Items {
		for _, cn := range c.Names {
			cn = strings.TrimPrefix(cn, "/")
			if strings.HasPrefix(cn, prefix) || c.Labels["com.docker.compose.project"] == name {
				proj.Containers = append(proj.Containers, Container{
					ID:     c.ID[:12],
					Name:   cn,
					Image:  c.Image,
					State:  string(c.State),
					Status: c.Status,
					Ports:  formatPorts(c.Ports),
				})
				if c.State == "running" {
					running++
				}
				break
			}
		}
	}

	switch {
	case len(proj.Containers) == 0 || running == 0:
		proj.Status = StatusStopped
	case running < len(proj.Containers):
		proj.Status = StatusPartial
	default:
		proj.Status = StatusRunning
	}

	return proj, nil
}

// SyncProject writes the compose file, .env, and extra project files to disk.
func (m *Manager) SyncProject(rec db.ProjectRecord) error {
	dir := filepath.Join(m.projectsDir, rec.Name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create project dir: %w", err)
	}

	composeFile := filepath.Join(dir, "docker-compose.yml")
	if err := os.WriteFile(composeFile, []byte(rec.Compose), 0o644); err != nil {
		return fmt.Errorf("write compose file: %w", err)
	}

	// Write .env file
	var envLines strings.Builder
	for k, v := range rec.EnvVars {
		envLines.WriteString(k)
		envLines.WriteByte('=')
		envLines.WriteString(v)
		envLines.WriteByte('\n')
	}
	envFile := filepath.Join(dir, ".env")
	if err := os.WriteFile(envFile, []byte(envLines.String()), 0o600); err != nil {
		return fmt.Errorf("write .env file: %w", err)
	}

	// Write extra project files
	if m.db != nil {
		extraFiles, err := db.ListProjectFiles(m.db, rec.Name)
		if err == nil {
			for _, f := range extraFiles {
				dest := filepath.Join(dir, f.Filename)
				// Ensure subdirectory exists for nested paths
				if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
					continue
				}
				_ = os.WriteFile(dest, []byte(f.Content), 0o644)
			}
		}
	}

	return nil
}

// DeleteProjectFiles removes the project directory from disk.
func (m *Manager) DeleteProjectFiles(name string) error {
	dir := filepath.Join(m.projectsDir, name)
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("remove project dir: %w", err)
	}
	return nil
}

// GetContainerNames returns the names of all containers belonging to a project.
func (m *Manager) GetContainerNames(ctx context.Context, name string) []string {
	if m.docker == nil {
		return nil
	}
	result, err := m.docker.ContainerList(ctx, client.ContainerListOptions{All: true})
	if err != nil {
		return nil
	}
	prefix := name + "-"
	var names []string
	for _, c := range result.Items {
		for _, cn := range c.Names {
			cn = strings.TrimPrefix(cn, "/")
			if strings.HasPrefix(cn, prefix) || c.Labels["com.docker.compose.project"] == name {
				names = append(names, cn)
				break
			}
		}
	}
	return names
}

func (m *Manager) Start(ctx context.Context, name string) error {
	slog.Info("starting project", "project", name)
	return m.runCompose(ctx, name, "up", "-d")
}

func (m *Manager) Stop(ctx context.Context, name string) error {
	slog.Info("stopping project", "project", name)
	return m.runCompose(ctx, name, "down")
}

func (m *Manager) Restart(ctx context.Context, name string) error {
	slog.Info("restarting project", "project", name)
	return m.runCompose(ctx, name, "restart")
}

// ContainerStat holds per-container CPU and memory stats.
type ContainerStat struct {
	Name       string  `json:"name"`
	CPUPercent float64 `json:"cpuPercent"`
	MemUsed    uint64  `json:"memUsed"`
	MemLimit   uint64  `json:"memLimit"`
}

// ContainerRef holds a container's ID and display name.
type ContainerRef struct {
	ID   string
	Name string
}

// DockerClient exposes the underlying Docker client for use in WS handlers.
func (m *Manager) DockerClient() *client.Client {
	return m.docker
}

// GetProjectContainerRefs returns id+name pairs for running containers in a project.
func (m *Manager) GetProjectContainerRefs(ctx context.Context, name string) []ContainerRef {
	if m.docker == nil {
		return nil
	}
	result, err := m.docker.ContainerList(ctx, client.ContainerListOptions{All: false})
	if err != nil {
		return nil
	}
	prefix := name + "-"
	var refs []ContainerRef
	for _, c := range result.Items {
		for _, cn := range c.Names {
			cn = strings.TrimPrefix(cn, "/")
			if strings.HasPrefix(cn, prefix) || c.Labels["com.docker.compose.project"] == name {
				refs = append(refs, ContainerRef{ID: c.ID, Name: cn})
				break
			}
		}
	}
	return refs
}

// ContainerAction starts, stops, or restarts a single container by ID.
func (m *Manager) ContainerAction(ctx context.Context, containerID, action string) error {
	if m.docker == nil {
		return fmt.Errorf("docker unavailable")
	}
	switch action {
	case "start":
		_, err := m.docker.ContainerStart(ctx, containerID, client.ContainerStartOptions{})
		return err
	case "stop":
		_, err := m.docker.ContainerStop(ctx, containerID, client.ContainerStopOptions{})
		return err
	case "restart":
		_, err := m.docker.ContainerRestart(ctx, containerID, client.ContainerRestartOptions{})
		return err
	default:
		return fmt.Errorf("unknown action: %s", action)
	}
}

// DeployEventType classifies a structured deploy event.
type DeployEventType string

const (
	DeployEventPullStart  DeployEventType = "pull_start"
	DeployEventPullLayer  DeployEventType = "pull_layer"
	DeployEventPullDone   DeployEventType = "pull_done"
	DeployEventCompose    DeployEventType = "compose"
	DeployEventDone       DeployEventType = "done"
)

// DeployEvent is a structured event emitted during a deploy operation.
type DeployEvent struct {
	Type    DeployEventType `json:"type"`
	Image   string          `json:"image,omitempty"`
	Layer   string          `json:"layer,omitempty"`
	Status  string          `json:"status,omitempty"`
	Current int64           `json:"current,omitempty"`
	Total   int64           `json:"total,omitempty"`
	Line    string          `json:"line,omitempty"`
	Success bool            `json:"success,omitempty"`
	Error   string          `json:"error,omitempty"`
}

// DeployStream pulls images via the Engine API (structured progress), then runs
// docker compose up --no-pull. It calls send for each structured event.
func (m *Manager) DeployStream(ctx context.Context, name string, send func(DeployEvent)) error {
	slog.Info("deploying project", "project", name)

	// Load compose content from DB to extract images.
	var composeContent string
	if m.db != nil {
		if rec, err := db.GetProjectByName(m.db, name); err == nil {
			composeContent = rec.Compose
		}
	}
	// Fall back to reading from disk.
	if composeContent == "" {
		b, err := os.ReadFile(filepath.Join(m.projectsDir, name, "docker-compose.yml"))
		if err == nil {
			composeContent = string(b)
		}
	}

	images := extractImages(composeContent)
	for _, image := range images {
		if err := m.pullImage(ctx, image, send); err != nil {
			// Non-fatal: compose up may still work if image is cached locally.
			send(DeployEvent{Type: DeployEventPullDone, Image: image, Error: err.Error()})
		}
	}

	// Run compose up, streaming each output line.
	// Docker reuses locally-cached images we just pulled, so no --no-pull flag needed.
	if err := m.runComposeStream(ctx, name, lineWriterFunc(func(line string) {
		send(DeployEvent{Type: DeployEventCompose, Line: line})
	}), "up", "-d"); err != nil {
		send(DeployEvent{Type: DeployEventDone, Error: err.Error()})
		return err
	}

	send(DeployEvent{Type: DeployEventDone, Success: true})
	return nil
}

// pullImage pulls a single image via the Engine API and emits layer progress events.
func (m *Manager) pullImage(ctx context.Context, image string, send func(DeployEvent)) error {
	if m.docker == nil {
		return fmt.Errorf("docker unavailable")
	}
	send(DeployEvent{Type: DeployEventPullStart, Image: image})

	resp, err := m.docker.ImagePull(ctx, image, client.ImagePullOptions{})
	if err != nil {
		return err
	}
	defer resp.Close()

	for msg, err := range resp.JSONMessages(ctx) {
		if err != nil {
			return err
		}
		evt := buildLayerEvent(image, msg)
		if evt != nil {
			send(*evt)
		}
	}

	send(DeployEvent{Type: DeployEventPullDone, Image: image})
	return nil
}

func buildLayerEvent(image string, msg jsonstream.Message) *DeployEvent {
	if msg.Error != nil {
		return &DeployEvent{Type: DeployEventPullLayer, Image: image, Status: "error", Layer: msg.ID, Error: msg.Error.Message}
	}
	if msg.Status == "" || msg.ID == "" {
		return nil
	}
	evt := &DeployEvent{
		Type:   DeployEventPullLayer,
		Image:  image,
		Layer:  msg.ID,
		Status: msg.Status,
	}
	if msg.Progress != nil {
		evt.Current = msg.Progress.Current
		evt.Total = msg.Progress.Total
	}
	return evt
}

// lineWriterFunc is an io.Writer that calls f for each complete line.
type lineWriterFunc func(string)

func (f lineWriterFunc) Write(p []byte) (int, error) {
	scanner := bufio.NewScanner(strings.NewReader(string(p)))
	for scanner.Scan() {
		if line := scanner.Text(); line != "" {
			f(line)
		}
	}
	return len(p), nil
}

// imageRe matches "image: some/image:tag" lines in a compose file.
var imageRe = regexp.MustCompile(`(?m)^\s+image:\s*["']?([^"'\s${}]+)["']?`)

// extractImages returns unique image references from compose YAML content.
func extractImages(content string) []string {
	seen := map[string]bool{}
	var images []string
	for _, m := range imageRe.FindAllStringSubmatch(content, -1) {
		img := m[1]
		if !seen[img] {
			seen[img] = true
			images = append(images, img)
		}
	}
	return images
}

// StartStream runs docker compose up and streams output to w in real-time.
func (m *Manager) StartStream(ctx context.Context, name string, w io.Writer) error {
	slog.Info("starting project (stream)", "project", name)
	return m.runComposeStream(ctx, name, w, "up", "-d")
}

// StopStream runs docker compose down and streams output to w in real-time.
func (m *Manager) StopStream(ctx context.Context, name string, w io.Writer) error {
	slog.Info("stopping project (stream)", "project", name)
	return m.runComposeStream(ctx, name, w, "down")
}

func (m *Manager) runCompose(ctx context.Context, name string, args ...string) error {
	dir := filepath.Join(m.projectsDir, name)
	if !hasComposeFile(dir) {
		return fmt.Errorf("project %q not found", name)
	}
	cmd := exec.CommandContext(ctx, "docker", append([]string{"compose"}, args...)...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		slog.Error("docker compose failed", "project", name, "args", args, "output", string(out))
		return fmt.Errorf("docker compose %v: %s", args, out)
	}
	return nil
}

func (m *Manager) runComposeStream(ctx context.Context, name string, w io.Writer, args ...string) error {
	dir := filepath.Join(m.projectsDir, name)
	if !hasComposeFile(dir) {
		return fmt.Errorf("project %q not found", name)
	}
	cmd := exec.CommandContext(ctx, "docker", append([]string{"compose"}, args...)...)
	cmd.Dir = dir
	cmd.Stdout = w
	cmd.Stderr = w
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("docker compose start: %w", err)
	}
	return cmd.Wait()
}

// LogStreamOptions configures log streaming behaviour.
type LogStreamOptions struct {
	Tail   string // "all" or a number string; default "200"
	Follow bool   // if false, drain existing logs and return
	Since  string // RFC3339 timestamp or empty
	Until  string // RFC3339 timestamp or empty
}

// StreamLogs streams logs for all containers in a project as JSON lines written to w.
// When opts.Follow is true it blocks until ctx is cancelled; otherwise it returns after draining.
func (m *Manager) StreamLogs(ctx context.Context, name string, w io.Writer, opts LogStreamOptions) error {
	if m.docker == nil {
		return fmt.Errorf("docker unavailable")
	}

	result, err := m.docker.ContainerList(ctx, client.ContainerListOptions{All: true})
	if err != nil {
		return err
	}

	var mu sync.Mutex
	var wg sync.WaitGroup
	prefix := name + "-"
	matched := 0
	for _, c := range result.Items {
		for _, cn := range c.Names {
			cn = strings.TrimPrefix(cn, "/")
			if strings.HasPrefix(cn, prefix) || c.Labels["com.docker.compose.project"] == name {
				slog.Info("streaming logs for container", "project", name, "container", cn, "id", c.ID[:12])
				matched++
				wg.Add(1)
				go func(id, containerName string) {
					defer wg.Done()
					streamContainerLogs(ctx, m.docker, id, containerName, w, &mu, opts)
				}(c.ID, cn)
				break
			}
		}
	}
	if matched == 0 {
		slog.Warn("no containers matched for log streaming", "project", name, "total_containers", len(result.Items))
	}
	if opts.Follow {
		<-ctx.Done()
	} else {
		wg.Wait()
	}
	return nil
}

func streamContainerLogs(ctx context.Context, cli *client.Client, id, name string, w io.Writer, mu *sync.Mutex, streamOpts LogStreamOptions) {
	// Inspect container to determine if it uses a TTY (raw stream) or multiplexed stream.
	info, err := cli.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
	isTTY := err == nil && info.Container.Config != nil && info.Container.Config.Tty

	tail := streamOpts.Tail
	if tail == "" {
		tail = "200"
	}
	opts := client.ContainerLogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     streamOpts.Follow,
		Timestamps: true,
		Tail:       tail,
		Since:      streamOpts.Since,
		Until:      streamOpts.Until,
	}
	rc, err := cli.ContainerLogs(ctx, id, opts)
	if err != nil {
		slog.Error("ContainerLogs failed", "container", name, "err", err)
		return
	}
	defer rc.Close()
	slog.Info("container log stream opened", "container", name, "tty", isTTY)

	var reader io.Reader
	if isTTY {
		// TTY containers send a raw byte stream — no multiplexed header.
		reader = rc
	} else {
		// Non-TTY containers use Docker's multiplexed frame format.
		pr, pw := io.Pipe()
		go func() {
			defer pw.Close()
			stdcopy.StdCopy(pw, pw, rc) //nolint:errcheck
		}()
		reader = pr
	}

	writeLine := func(line string) {
		b, err := json.Marshal(map[string]string{
			"container": name,
			"log":       line,
			"time":      time.Now().UTC().Format(time.RFC3339),
		})
		if err != nil {
			return
		}
		mu.Lock()
		w.Write(b)            //nolint:errcheck
		w.Write([]byte{'\n'}) //nolint:errcheck
		mu.Unlock()
	}

	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024) // allow up to 1MB lines
	for scanner.Scan() {
		writeLine(scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		slog.Warn("log scanner error", "container", name, "err", err)
	}
}

func hasComposeFile(dir string) bool {
	for _, name := range []string{"docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
			return true
		}
	}
	return false
}

func formatPorts(ports []container.PortSummary) string {
	parts := make([]string, 0, len(ports))
	for _, p := range ports {
		if p.PublicPort != 0 {
			parts = append(parts, fmt.Sprintf("%d->%d/%s", p.PublicPort, p.PrivatePort, p.Type))
		} else {
			parts = append(parts, fmt.Sprintf("%d/%s", p.PrivatePort, p.Type))
		}
	}
	return strings.Join(parts, ", ")
}
