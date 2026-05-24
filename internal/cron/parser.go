// Package cron provides utilities for reading, writing, and parsing system crontabs.
package cron

import (
	"crypto/sha256"
	"fmt"
	"strings"
	"time"
	"unicode"

	robfigcron "github.com/robfig/cron/v3"
)

// EntryType categorises a parsed crontab line.
type EntryType string

const (
	EntryTypeJob     EntryType = "job"
	EntryTypeComment EntryType = "comment"
	EntryTypeEnvVar  EntryType = "env"
	EntryTypeBlank   EntryType = "blank"
)

// CronEntry represents a single logical line in a crontab.
type CronEntry struct {
	// ID is a stable identifier derived from the entry's position + content.
	ID string `json:"id"`
	// Type of line.
	Type EntryType `json:"type"`

	// --- Fields valid when Type == EntryTypeJob ---
	Disabled bool   `json:"disabled"` // line is commented-out job
	Special  string `json:"special"`  // @reboot, @daily, etc. (empty for standard schedule)
	Minute   string `json:"minute"`
	Hour     string `json:"hour"`
	Day      string `json:"day"`
	Month    string `json:"month"`
	Weekday  string `json:"weekday"`
	Command  string `json:"command"`
	Comment  string `json:"comment"`  // inline comment after command
	NextRun  string `json:"nextRun"`  // RFC3339 or "" if not computable

	// --- Fields valid when Type == EntryTypeComment ---
	Raw string `json:"raw"` // original text (for comments/blanks/env vars)
}

// Schedule returns the crontab schedule string for a job entry.
func (e *CronEntry) Schedule() string {
	if e.Special != "" {
		return e.Special
	}
	return fmt.Sprintf("%s %s %s %s %s", e.Minute, e.Hour, e.Day, e.Month, e.Weekday)
}

var specials = map[string]bool{
	"@reboot": true, "@yearly": true, "@annually": true,
	"@monthly": true, "@weekly": true, "@daily": true,
	"@midnight": true, "@hourly": true,
}

// ParseCrontab parses raw crontab text into a list of CronEntry values.
func ParseCrontab(text string) []CronEntry {
	lines := strings.Split(text, "\n")
	entries := make([]CronEntry, 0, len(lines))
	parser := robfigcron.NewParser(robfigcron.Minute | robfigcron.Hour | robfigcron.Dom | robfigcron.Month | robfigcron.Dow | robfigcron.Descriptor)

	for i, line := range lines {
		raw := line
		trimmed := strings.TrimSpace(line)

		id := stableID(i, trimmed)

		// Blank line.
		if trimmed == "" {
			entries = append(entries, CronEntry{ID: id, Type: EntryTypeBlank, Raw: raw})
			continue
		}

		// Pure comment (not a disabled job).
		if strings.HasPrefix(trimmed, "#") {
			// Check if it looks like a disabled job line.
			rest := strings.TrimSpace(strings.TrimPrefix(trimmed, "#"))
			if entry, ok := parseJobLine(rest, parser, true); ok {
				entry.ID = id
				entry.Disabled = true
				entries = append(entries, entry)
				continue
			}
			entries = append(entries, CronEntry{ID: id, Type: EntryTypeComment, Raw: raw})
			continue
		}

		// Env var assignment: KEY=value (no spaces around =, or KEY = value).
		if isEnvLine(trimmed) {
			entries = append(entries, CronEntry{ID: id, Type: EntryTypeEnvVar, Raw: raw})
			continue
		}

		// Job line.
		if entry, ok := parseJobLine(trimmed, parser, false); ok {
			entry.ID = id
			entries = append(entries, entry)
			continue
		}

		// Fallback: treat as comment/unknown.
		entries = append(entries, CronEntry{ID: id, Type: EntryTypeComment, Raw: raw})
	}

	return entries
}

func parseJobLine(line string, parser robfigcron.Parser, disabled bool) (CronEntry, bool) {
	// Strip inline comment from end.
	inlineComment := ""
	if idx := indexInlineComment(line); idx >= 0 {
		inlineComment = strings.TrimSpace(line[idx+1:])
		line = strings.TrimSpace(line[:idx])
	}

	fields := strings.Fields(line)
	if len(fields) < 2 {
		return CronEntry{}, false
	}

	entry := CronEntry{
		Type:    EntryTypeJob,
		Disabled: disabled,
		Comment: inlineComment,
	}

	// Special @descriptor.
	if specials[fields[0]] {
		entry.Special = fields[0]
		entry.Command = strings.Join(fields[1:], " ")
		computeNextRun(&entry, parser)
		return entry, true
	}

	// Standard: min hour dom month dow command...
	if len(fields) < 6 {
		return CronEntry{}, false
	}
	entry.Minute = fields[0]
	entry.Hour = fields[1]
	entry.Day = fields[2]
	entry.Month = fields[3]
	entry.Weekday = fields[4]
	entry.Command = strings.Join(fields[5:], " ")
	computeNextRun(&entry, parser)
	return entry, true
}

func computeNextRun(entry *CronEntry, parser robfigcron.Parser) {
	if entry.Disabled || entry.Special == "@reboot" {
		return
	}
	sched, err := parser.Parse(entry.Schedule())
	if err != nil {
		return
	}
	next := sched.Next(time.Now())
	if !next.IsZero() {
		entry.NextRun = next.UTC().Format(time.RFC3339)
	}
}

// indexInlineComment returns the index of a # that is not inside quotes.
func indexInlineComment(s string) int {
	inQ := false
	qChar := rune(0)
	for i, ch := range s {
		if inQ {
			if ch == qChar {
				inQ = false
			}
			continue
		}
		if ch == '\'' || ch == '"' {
			inQ = true
			qChar = ch
			continue
		}
		if ch == '#' {
			return i
		}
	}
	return -1
}

func isEnvLine(s string) bool {
	eq := strings.Index(s, "=")
	if eq < 0 {
		return false
	}
	key := strings.TrimSpace(s[:eq])
	if key == "" {
		return false
	}
	for _, ch := range key {
		if !unicode.IsLetter(ch) && !unicode.IsDigit(ch) && ch != '_' {
			return false
		}
	}
	return true
}

func stableID(lineIdx int, content string) string {
	h := sha256.Sum256([]byte(fmt.Sprintf("%d|%s", lineIdx, content)))
	return fmt.Sprintf("%x", h[:8])
}

// SerializeCrontab converts a list of CronEntry values back to crontab text.
// Non-job entries keep their raw form; job entries are re-serialised.
func SerializeCrontab(entries []CronEntry) string {
	var sb strings.Builder
	for i, e := range entries {
		if i > 0 {
			sb.WriteByte('\n')
		}
		switch e.Type {
		case EntryTypeJob:
			if e.Disabled {
				sb.WriteByte('#')
			}
			if e.Special != "" {
				sb.WriteString(e.Special)
				sb.WriteByte(' ')
				sb.WriteString(e.Command)
			} else {
				sb.WriteString(e.Minute)
				sb.WriteByte(' ')
				sb.WriteString(e.Hour)
				sb.WriteByte(' ')
				sb.WriteString(e.Day)
				sb.WriteByte(' ')
				sb.WriteString(e.Month)
				sb.WriteByte(' ')
				sb.WriteString(e.Weekday)
				sb.WriteByte(' ')
				sb.WriteString(e.Command)
			}
			if e.Comment != "" {
				sb.WriteString(" # ")
				sb.WriteString(e.Comment)
			}
		default:
			sb.WriteString(e.Raw)
		}
	}
	return sb.String()
}

// ValidateExpression parses a cron schedule expression and returns the next N run times.
func ValidateExpression(expr string, count int) ([]string, error) {
	parser := robfigcron.NewParser(robfigcron.Minute | robfigcron.Hour | robfigcron.Dom | robfigcron.Month | robfigcron.Dow | robfigcron.Descriptor)
	sched, err := parser.Parse(expr)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	results := make([]string, 0, count)
	for i := 0; i < count; i++ {
		now = sched.Next(now)
		results = append(results, now.UTC().Format(time.RFC3339))
	}
	return results, nil
}
