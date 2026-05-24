package main

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"strings"
	"text/template"

	"github.com/tomasweigenast/vps-pilot/internal/config"
)

const serviceUser = "vps-pilot"
const serviceFilePath = "/lib/systemd/system/vps-pilot.service"
const defaultConfigPath = "/etc/vps-pilot/config.toml"
const defaultDataDir = "/var/lib/vps-pilot"

// serviceTemplate is the systemd unit written by the install wizard.
// DataDir and ProjectsDir are interpolated from the wizard answers.
const serviceTemplate = `[Unit]
Description=VPS Pilot
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=vps-pilot
Group=docker
ExecStart=/usr/local/bin/vps-pilot
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths={{.DataDir}} {{.ProjectsDir}}
ReadOnlyPaths=/etc/vps-pilot

[Install]
WantedBy=multi-user.target
`

func runInstall() {
	if os.Getuid() != 0 {
		fmt.Fprintln(os.Stderr, "error: vps-pilot install must be run as root (sudo vps-pilot install)")
		os.Exit(1)
	}

	fmt.Printf("vps-pilot %s — installation wizard\n\n", version)
	fmt.Println("Press Enter to accept the default value shown in [brackets].")
	fmt.Println()

	reader := bufio.NewReader(os.Stdin)

	// -- Wizard questions -------------------------------------------------------

	listenAddr := prompt(reader, "Listen address", "0.0.0.0:8080")
	projectsDir := prompt(reader, "Projects directory", "/opt/projects")
	authMode := promptChoice(reader, "Auth mode", []string{"both", "pam", "local"})
	tlsCert := prompt(reader, "TLS certificate path (leave empty for plain HTTP)", "")
	tlsKey := ""
	if tlsCert != "" {
		tlsKey = prompt(reader, "TLS key path", "")
	}

	fmt.Println()

	// -- Check existing config --------------------------------------------------

	configPath := defaultConfigPath
	if _, err := os.Stat(configPath); err == nil {
		overwrite := promptYesNo(reader, "Config already exists at "+configPath+". Overwrite?", false)
		if !overwrite {
			fmt.Println("Keeping existing config.")
			configPath = "" // skip writing
		}
	}

	// -- System user ------------------------------------------------------------

	step("Creating system user")
	if err := ensureServiceUser(); err != nil {
		fatal("create system user", err)
	}
	ok("User vps-pilot ready")

	// -- Directories ------------------------------------------------------------

	step("Creating directories")
	svcUID, svcGID, err := lookupUserIDs(serviceUser)
	if err != nil {
		fatal("lookup vps-pilot uid/gid", err)
	}
	dirs := []struct {
		path string
		mode os.FileMode
		uid  int
		gid  int
	}{
		{"/etc/vps-pilot", 0o755, 0, 0},
		{defaultDataDir, 0o750, svcUID, svcGID},
		{projectsDir, 0o755, svcUID, svcGID},
	}
	for _, d := range dirs {
		if err := os.MkdirAll(d.path, d.mode); err != nil {
			fatal("create "+d.path, err)
		}
		if err := os.Chown(d.path, d.uid, d.gid); err != nil {
			fatal("chown "+d.path, err)
		}
	}
	ok("Directories ready")

	// -- Config file ------------------------------------------------------------

	if configPath != "" {
		step("Generating config file")
		secret, err := config.GenerateCookieSecret()
		if err != nil {
			fatal("generate cookie secret", err)
		}
		content := config.DefaultConfigContent(config.ConfigDefaults{
			CookieSecret: secret,
			ListenAddr:   listenAddr,
			DataDir:      defaultDataDir,
			ProjectsDir:  projectsDir,
			AuthMode:     authMode,
			TLSCert:      tlsCert,
			TLSKey:       tlsKey,
		})
		if err := os.WriteFile(configPath, []byte(content), 0o600); err != nil {
			fatal("write config", err)
		}
		ok("Config written to " + configPath)
	}

	// -- Systemd service file --------------------------------------------------

	step("Installing systemd service")
	svcContent, err := renderServiceFile(defaultDataDir, projectsDir)
	if err != nil {
		fatal("render service file", err)
	}
	if err := os.WriteFile(serviceFilePath, []byte(svcContent), 0o644); err != nil {
		fatal("write service file", err)
	}
	ok("Service file written to " + serviceFilePath)

	// -- Enable and start ------------------------------------------------------

	step("Enabling service")
	runCmd("systemctl", "daemon-reload")
	runCmd("systemctl", "enable", "vps-pilot")

	alreadyActive := exec.Command("systemctl", "is-active", "--quiet", "vps-pilot").Run() == nil
	if alreadyActive {
		runCmd("systemctl", "restart", "vps-pilot")
		ok("Service restarted")
	} else {
		runCmd("systemctl", "start", "vps-pilot")
		ok("Service started")
	}

	// -- Summary ---------------------------------------------------------------

	fmt.Println()
	fmt.Println("vps-pilot installed successfully.")
	fmt.Println()
	fmt.Println("  Config:   " + configPath)
	fmt.Println("  Data:     " + defaultDataDir)
	fmt.Println("  Projects: " + projectsDir)
	fmt.Println("  Logs:     journalctl -u vps-pilot -f")
	fmt.Println()
	fmt.Println("  Create a local user:")
	fmt.Println("    vps-pilot adduser <username>")
	fmt.Println()
	fmt.Println("  Edit " + configPath + " and run 'systemctl restart vps-pilot' to apply changes.")
}

// -- Helpers -------------------------------------------------------------------

func prompt(r *bufio.Reader, label, defaultVal string) string {
	if defaultVal != "" {
		fmt.Printf("  %s [%s]: ", label, defaultVal)
	} else {
		fmt.Printf("  %s: ", label)
	}
	line, _ := r.ReadString('\n')
	line = strings.TrimSpace(line)
	if line == "" {
		return defaultVal
	}
	return line
}

func promptChoice(r *bufio.Reader, label string, choices []string) string {
	fmt.Printf("  %s (%s) [%s]: ", label, strings.Join(choices, "/"), choices[0])
	line, _ := r.ReadString('\n')
	line = strings.TrimSpace(strings.ToLower(line))
	if line == "" {
		return choices[0]
	}
	for _, c := range choices {
		if line == c {
			return c
		}
	}
	fmt.Printf("  Invalid choice %q, using default %q\n", line, choices[0])
	return choices[0]
}

func promptYesNo(r *bufio.Reader, label string, defaultYes bool) bool {
	def := "y/N"
	if defaultYes {
		def = "Y/n"
	}
	fmt.Printf("  %s [%s]: ", label, def)
	line, _ := r.ReadString('\n')
	line = strings.TrimSpace(strings.ToLower(line))
	if line == "" {
		return defaultYes
	}
	return line == "y" || line == "yes"
}

func step(msg string) { fmt.Println("- " + msg + "...") }
func ok(msg string)   { fmt.Println("  [ok] " + msg) }

func fatal(what string, err error) {
	fmt.Fprintf(os.Stderr, "error: %s: %v\n", what, err)
	os.Exit(1)
}

func runCmd(name string, args ...string) {
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fatal("run "+name, err)
	}
}

func ensureServiceUser() error {
	// Check if user already exists.
	if _, err := user.Lookup(serviceUser); err == nil {
		// Already exists — ensure docker group membership.
		return addToDockerGroup()
	}
	// Create system user.
	cmd := exec.Command("useradd",
		"--system",
		"--no-create-home",
		"--shell", "/usr/sbin/nologin",
		serviceUser,
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("useradd: %w — %s", err, strings.TrimSpace(string(out)))
	}
	return addToDockerGroup()
}

func addToDockerGroup() error {
	// Only add if docker group exists.
	cmd := exec.Command("getent", "group", "docker")
	if err := cmd.Run(); err != nil {
		return nil // docker group doesn't exist, skip
	}
	out, err := exec.Command("usermod", "-aG", "docker", serviceUser).CombinedOutput()
	if err != nil {
		return fmt.Errorf("usermod: %w — %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func lookupUserIDs(username string) (uid, gid int, err error) {
	u, err := user.Lookup(username)
	if err != nil {
		return 0, 0, err
	}
	var uidVal, gidVal int
	fmt.Sscanf(u.Uid, "%d", &uidVal)
	fmt.Sscanf(u.Gid, "%d", &gidVal)
	return uidVal, gidVal, nil
}

func renderServiceFile(dataDir, projectsDir string) (string, error) {
	tmpl, err := template.New("service").Parse(serviceTemplate)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, struct{ DataDir, ProjectsDir string }{dataDir, projectsDir}); err != nil {
		return "", err
	}
	return buf.String(), nil
}
