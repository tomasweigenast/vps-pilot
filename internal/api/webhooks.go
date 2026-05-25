package api

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/tomasweigenast/vps-pilot/internal/db"
	"github.com/tomasweigenast/vps-pilot/internal/docker"
)

type webhooksHandler struct {
	database *sql.DB
	manager  *docker.Manager
}

func generateToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (h *webhooksHandler) list(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	hooks, err := db.ListWebhooks(h.database, name)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if hooks == nil {
		hooks = []db.Webhook{}
	}
	jsonOK(w, hooks)
}

func (h *webhooksHandler) createProjectWebhook(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	h.createWebhook(w, r, name, "")
}

func (h *webhooksHandler) createServiceWebhook(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	service := chi.URLParam(r, "service")
	h.createWebhook(w, r, name, service)
}

func (h *webhooksHandler) createWebhook(w http.ResponseWriter, r *http.Request, projectName, serviceName string) {
	token, err := generateToken()
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "generate token")
		return
	}
	hook, err := db.CreateWebhook(h.database, token, projectName, serviceName)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logAudit(r, h.database, "webhook.create", projectName, serviceName)
	jsonOK(w, hook)
}

func (h *webhooksHandler) deleteWebhook(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "webhookId"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := db.DeleteWebhook(h.database, id); err != nil {
		if errors.Is(err, db.ErrWebhookNotFound) {
			http.NotFound(w, r)
			return
		}
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logAudit(r, h.database, "webhook.delete", chi.URLParam(r, "name"), "")
	w.WriteHeader(http.StatusNoContent)
}

// publicWebhookTrigger handles unauthenticated POST /webhooks/:project/:token
// and /webhooks/:project/:service/:token. Returns {"ok":true} immediately and
// fires the deploy in the background.
func (h *webhooksHandler) publicWebhookTrigger(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	hook, err := db.GetWebhookByToken(h.database, token)
	if errors.Is(err, db.ErrWebhookNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	_ = db.RecordWebhookCall(h.database, hook.ID)

	regs, _ := db.ListRegistries(h.database)

	// Fire deploy asynchronously so the caller gets an instant response.
	go func() {
		ctx := context.Background()
		noop := func(docker.DeployEvent) {}
		var err error
		if hook.ServiceName != "" {
			err = h.manager.PullServiceStream(ctx, hook.ProjectName, hook.ServiceName, regs, noop)
		} else {
			err = h.manager.PullNewImagesStream(ctx, hook.ProjectName, regs, false, noop)
		}
		if err != nil {
			slog.Error("webhook deploy failed", "project", hook.ProjectName, "service", hook.ServiceName, "err", err)
		} else {
			slog.Info("webhook deploy succeeded", "project", hook.ProjectName, "service", hook.ServiceName)
		}
	}()

	jsonOK(w, map[string]bool{"ok": true})
}
