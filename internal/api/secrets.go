package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/tomasweigenast/vps-pilot/internal/db"
	"github.com/tomasweigenast/vps-pilot/internal/secrets"
)

type secretsHandler struct {
	database   *sql.DB
	secretsKey []byte
}

// secretView is the safe DTO — value is never included.
type secretView struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedBy   string `json:"createdBy"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

func toSecretView(s db.Secret) secretView {
	return secretView{
		ID:          s.ID,
		Name:        s.Name,
		Description: s.Description,
		CreatedBy:   s.CreatedBy,
		CreatedAt:   s.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		UpdatedAt:   s.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z"),
	}
}

func (h *secretsHandler) list(w http.ResponseWriter, r *http.Request) {
	list, err := db.ListSecrets(h.database)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]secretView, len(list))
	for i, s := range list {
		out[i] = toSecretView(s)
	}
	jsonOK(w, out)
}

type createSecretInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Value       string `json:"value"`
}

func (h *secretsHandler) create(w http.ResponseWriter, r *http.Request) {
	var inp createSecretInput
	if err := json.NewDecoder(r.Body).Decode(&inp); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if inp.Name == "" || inp.Value == "" {
		jsonErr(w, http.StatusBadRequest, "name and value are required")
		return
	}
	blob, err := secrets.Encrypt(h.secretsKey, []byte(inp.Value))
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "encryption failed")
		return
	}
	user := sessionFromCtx(r.Context())
	createdBy := ""
	if user != nil {
		createdBy = user.Username
	}
	s, err := db.CreateSecret(h.database, inp.Name, inp.Description, createdBy, blob)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logAudit(r, h.database, "secret.create", inp.Name, "")
	jsonOK(w, toSecretView(*s))
}

type updateSecretInput struct {
	Description string `json:"description"`
	Value       string `json:"value"` // optional — empty keeps existing
}

func (h *secretsHandler) update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var inp updateSecretInput
	if err := json.NewDecoder(r.Body).Decode(&inp); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	var blob []byte
	if inp.Value != "" {
		blob, err = secrets.Encrypt(h.secretsKey, []byte(inp.Value))
		if err != nil {
			jsonErr(w, http.StatusInternalServerError, "encryption failed")
			return
		}
	}

	if err := db.UpdateSecret(h.database, id, inp.Description, blob); err != nil {
		if errors.Is(err, db.ErrSecretNotFound) {
			http.NotFound(w, r)
			return
		}
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logAudit(r, h.database, "secret.update", strconv.FormatInt(id, 10), "")
	w.WriteHeader(http.StatusNoContent)
}

func (h *secretsHandler) delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	// Get name for audit log before deletion.
	s, err := db.GetSecret(h.database, id)
	if errors.Is(err, db.ErrSecretNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := db.DeleteSecret(h.database, id); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logAudit(r, h.database, "secret.delete", s.Name, "")
	w.WriteHeader(http.StatusNoContent)
}

// reveal decrypts and returns the secret value. Admin only, always audit-logged.
func (h *secretsHandler) reveal(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	blob, err := db.GetSecretEncrypted(h.database, id)
	if errors.Is(err, db.ErrSecretNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	plain, err := secrets.Decrypt(h.secretsKey, blob)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "decryption failed")
		return
	}
	logAudit(r, h.database, "secret.reveal", strconv.FormatInt(id, 10), "")
	jsonOK(w, map[string]string{"value": string(plain)})
}

// --- Project secrets ---

type projectSecretsHandler struct {
	database *sql.DB
}

func (h *projectSecretsHandler) list(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	list, err := db.ListProjectSecrets(h.database, name)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	type item struct {
		SecretID   int64  `json:"secretId"`
		SecretName string `json:"secretName"`
		EnvVarName string `json:"envVarName"`
	}
	out := make([]item, len(list))
	for i, ps := range list {
		out[i] = item{SecretID: ps.SecretID, SecretName: ps.SecretName, EnvVarName: ps.EnvVarName}
	}
	jsonOK(w, out)
}

type setProjectSecretsInput struct {
	Secrets []struct {
		SecretID   int64  `json:"secretId"`
		EnvVarName string `json:"envVarName"`
	} `json:"secrets"`
}

func (h *projectSecretsHandler) set(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	var inp setProjectSecretsInput
	if err := json.NewDecoder(r.Body).Decode(&inp); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	items := make([]db.ProjectSecretInput, len(inp.Secrets))
	for i, s := range inp.Secrets {
		if s.EnvVarName == "" {
			jsonErr(w, http.StatusBadRequest, "envVarName is required for each secret")
			return
		}
		items[i] = db.ProjectSecretInput{SecretID: s.SecretID, EnvVarName: s.EnvVarName}
	}
	if err := db.SetProjectSecrets(h.database, name, items); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logAudit(r, h.database, "project.secrets.update", name, "")
	w.WriteHeader(http.StatusNoContent)
}
