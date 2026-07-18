import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { api } from "../api";
import ConfirmPanel from "../components/ConfirmPanel";
import { getAllTasksLocal, getTaskLocal, putTaskLocal, queue, type LocalTask, type Status, type TaskTag, type TaskType } from "../offline/db";
import {
  DEFAULT_TAG_COLOR,
  TASK_LIMITS,
  asQueuedUpdate,
  cleanTaskText,
  isLocalId,
  normalizeTagColor,
  normalizeTask,
  validateTaskDraft,
} from "../tasks";

const STATUS_OPTIONS: Status[] = ["Pendiente", "En Progreso", "Completada"];
type ConfirmState = {
  title: string;
  message: string;
  confirmText: string;
  tone?: "danger" | "neutral";
  onConfirm: () => void | Promise<void>;
};

function tagKey(tag: TaskTag) {
  return `${tag.name.trim().toLowerCase()}-${tag.color}`;
}

function getRecentTags(tasks: LocalTask[]) {
  const seen = new Set<string>();
  const list: TaskTag[] = [];

  for (const task of tasks) {
    for (const tag of task.tags) {
      const key = tagKey(tag);
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(tag);
      if (list.length >= 8) return list;
    }
  }

  return list;
}

function collaboratorId(user: LocalTask["collaborators"][number]["user"]) {
  return typeof user === "string" ? user : user._id ?? user.id ?? "";
}

function collaboratorName(user: LocalTask["collaborators"][number]["user"]) {
  return typeof user === "string" ? "Usuario invitado" : user.name || user.email || "Usuario invitado";
}

export default function TaskEdit() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState<LocalTask | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Status>("Pendiente");
  const [taskType, setTaskType] = useState<TaskType>("individual");
  const [tags, setTags] = useState<TaskTag[]>([]);
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState(DEFAULT_TAG_COLOR);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [recentTags, setRecentTags] = useState<TaskTag[]>([]);
  const [sharePermission, setSharePermission] = useState<"view" | "edit">("view");
  const [shareUrl, setShareUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const localTasks = await getAllTasksLocal();
        setRecentTags(getRecentTags(localTasks.map(normalizeTask)));

        const local = await getTaskLocal(id);
        if (local) {
          const normalized = normalizeTask(local);
          setTask(normalized);
          setTitle(normalized.title);
          setDescription(normalized.description ?? "");
          setStatus(normalized.status);
          setTaskType(normalized.type);
          setTags(normalized.tags);
          setSharePermission(normalized.invite?.permission ?? "view");
          return;
        }

        const { data } = await api.get(`/tasks/${id}`);
        const remote = normalizeTask(data?.task ?? data);
        setTask(remote);
        setTitle(remote.title);
        setDescription(remote.description ?? "");
        setStatus(remote.status);
        setTaskType(remote.type);
        setTags(remote.tags);
        setSharePermission(remote.invite?.permission ?? "view");
      } catch {
        setMessage("No se pudo cargar la tarea");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  function addTag() {
    const name = cleanTaskText(tagName, TASK_LIMITS.tagNameMax);
    setMessage("");

    if (name.length < TASK_LIMITS.tagNameMin) {
      setMessage(`La etiqueta debe tener al menos ${TASK_LIMITS.tagNameMin} caracteres.`);
      return;
    }

    if (tags.length >= TASK_LIMITS.tagsMax) {
      setMessage(`Solo puedes agregar hasta ${TASK_LIMITS.tagsMax} etiquetas.`);
      return;
    }

    if (tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) {
      setMessage("Esa etiqueta ya esta agregada.");
      return;
    }

    setTags((current) => [...current, { name, color: normalizeTagColor(tagColor) }]);
    setTagName("");
  }

  function addRecentTag(tag: TaskTag) {
    if (tags.length >= 6 || tags.some((item) => tagKey(item) === tagKey(tag))) return;
    setTags((current) => [...current, tag]);
  }

  async function saveTask(e: React.FormEvent) {
    e.preventDefault();
    if (!task) return;
    if (!task.canEdit || task.status === "Completada") {
      setMessage("Esta tarea no se puede editar con tus permisos actuales.");
      return;
    }

    const cleanTitle = cleanTaskText(title, TASK_LIMITS.titleMax);
    const cleanDescription = cleanTaskText(description, TASK_LIMITS.descriptionMax);
    const cleanTags = tags.map((tag) => ({
      name: cleanTaskText(tag.name, TASK_LIMITS.tagNameMax),
      color: normalizeTagColor(tag.color),
    }));
    const validation = validateTaskDraft(cleanTitle, cleanDescription, cleanTags);

    if (validation) {
      setMessage(validation);
      return;
    }

    const patched: LocalTask = {
      ...task,
      title: cleanTitle,
      description: cleanDescription,
      status,
      type: taskType,
      tags: cleanTags,
      pending: isLocalId(task._id) || task.pending,
    };

    setSaving(true);
    setMessage("");
    await putTaskLocal(patched);

    if (!navigator.onLine || isLocalId(task._id)) {
      await queue(asQueuedUpdate(patched, {
        title: patched.title,
        description: patched.description,
        status: patched.status,
        type: patched.type,
        tags: patched.tags,
      }));
      navigate("/dashboard");
      return;
    }

    try {
      await api.put(`/tasks/${task._id}`, {
        title: patched.title,
        description: patched.description,
        status: patched.status,
        type: patched.type,
        tags: patched.tags,
      });
      navigate("/dashboard");
    } catch (error) {
      if ((error as { response?: { status?: number } }).response?.status === 409) {
        await putTaskLocal(task);
        setTitle(task.title);
        setDescription(task.description ?? "");
        setStatus(task.status);
        setTags(task.tags);
        setMessage("Esta tarea ya fue completada y no se puede editar.");
        return;
      }
      await queue(asQueuedUpdate(patched, {
        title: patched.title,
        description: patched.description,
        status: patched.status,
        tags: patched.tags,
      }));
      navigate("/dashboard");
    } finally {
      setSaving(false);
    }
  }

  const taskCompleted = task?.status === "Completada";
  const canEditTask = !!task?.canEdit && !taskCompleted;
  const canManageTask = !!task?.canManage && !taskCompleted;

  async function refreshTask() {
    if (!task) return;
    const { data } = await api.get(`/tasks/${task._id}`);
    const remote = normalizeTask(data?.task ?? data);
    setTask(remote);
    setTitle(remote.title);
    setDescription(remote.description ?? "");
    setStatus(remote.status);
    setTaskType(remote.type);
    setTags(remote.tags);
    setSharePermission(remote.invite?.permission ?? "view");
    await putTaskLocal(remote);
  }

  async function generateInvite() {
    if (!task) return;
    setMessage("");

    try {
      const { data } = await api.post(`/tasks/${task._id}/invite`, { permission: sharePermission });
      const token = String(data?.token ?? "");
      const url = `${window.location.origin}/join/${token}`;
      setShareUrl(url);
      setQrDataUrl(await QRCode.toDataURL(url, { margin: 2, width: 220, color: { dark: "#000000", light: "#f2f2f2" } }));
      await refreshTask();
    } catch (error) {
      setMessage((error as { response?: { data?: { message?: string } } }).response?.data?.message ?? "No se pudo generar el QR.");
    }
  }

  async function changeCollaboratorPermission(userId: string, permission: "view" | "edit") {
    if (!task) return;
    await api.patch(`/tasks/${task._id}/collaborators/${userId}`, { permission });
    await refreshTask();
  }

  async function deleteCollaborator(userId: string) {
    if (!task) return;
    await api.delete(`/tasks/${task._id}/collaborators/${userId}`);
    await refreshTask();
  }

  function askDeleteCollaborator(userId: string, name: string) {
    setConfirm({
      title: "Quitar colaborador",
      message: `${name} dejara de ver esta tarea compartida.`,
      confirmText: "Quitar",
      tone: "danger",
      onConfirm: () => deleteCollaborator(userId),
    });
  }

  async function runConfirm() {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await confirm.onConfirm();
      setConfirm(null);
    } catch {
      setMessage("No se pudo completar la accion. Revisa tu conexion e intenta de nuevo.");
    } finally {
      setConfirmBusy(false);
    }
  }

  useEffect(() => {
    if (!task || canEditTask) return;

    const interval = window.setInterval(() => {
      void (async () => {
        const { data } = await api.get(`/tasks/${task._id}`);
        const remote = normalizeTask(data?.task ?? data);
        setTask(remote);
        setTitle(remote.title);
        setDescription(remote.description ?? "");
        setStatus(remote.status);
        setTaskType(remote.type);
        setTags(remote.tags);
        setSharePermission(remote.invite?.permission ?? "view");
        await putTaskLocal(remote);
      })();
    }, 8000);

    return () => window.clearInterval(interval);
  }, [canEditTask, task]);

  return (
    <div className="app-shell narrow-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Editar tarea</p>
          <h1>{loading ? "Cargando" : title || "Tarea"}</h1>
        </div>
        <Link className="btn ghost" to="/dashboard">Volver</Link>
      </header>

      <main className="section-card">
        {loading ? (
          <p className="empty loading-state">Cargando tarea...</p>
        ) : !task ? (
          <p className="empty">{message || "Tarea no encontrada"}</p>
        ) : (
          <form className="detail-form" onSubmit={saveTask}>
            {(taskCompleted || !canEditTask) && (
              <p className="form-message">
                {taskCompleted ? "Esta tarea ya fue completada y queda solo para consulta." : "Solo puedes visualizar esta tarea."}
              </p>
            )}
            <label>
              Titulo
              <input value={title} onChange={(event) => setTitle(event.target.value)} minLength={TASK_LIMITS.titleMin} maxLength={TASK_LIMITS.titleMax} required disabled={!canEditTask} />
            </label>
            <label>
              Descripcion
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} maxLength={TASK_LIMITS.descriptionMax} disabled={!canEditTask} />
            </label>
            <label>
              Tipo
              <select value={taskType} onChange={(event) => setTaskType(event.target.value as TaskType)} disabled={!canManageTask}>
                <option value="individual">Individual</option>
                <option value="group">Grupo</option>
              </select>
            </label>
            <label>
              Estado
              <select value={status} onChange={(event) => setStatus(event.target.value as Status)} disabled={!canEditTask}>
                {STATUS_OPTIONS.map((option) => <option value={option} key={option}>{option}</option>)}
              </select>
            </label>

            <div className="tag-editor" aria-disabled={!canEditTask}>
              <span className="label">Etiquetas</span>
              <div className="tag-builder">
                <input value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="Nombre de etiqueta" maxLength={TASK_LIMITS.tagNameMax} disabled={!canEditTask} />
                <div className="color-picker" aria-label="Color de etiqueta">
                  <span className="color-preview" style={{ backgroundColor: normalizeTagColor(tagColor) }} aria-hidden="true" />
                  <input
                    className="color-input"
                    type="color"
                    value={normalizeTagColor(tagColor)}
                    onChange={(event) => setTagColor(normalizeTagColor(event.target.value))}
                    aria-label="Elegir color de etiqueta"
                    disabled={!canEditTask}
                  />
                </div>
                <button className="btn ghost" type="button" onClick={addTag} disabled={!canEditTask}>Agregar</button>
              </div>
              {recentTags.length > 0 && (
                <div className="recent-tags" aria-label="Etiquetas recientes">
                  <span className="label">Etiquetas recientes</span>
                  <div className="recent-tag-list">
                    {recentTags.map((tag) => (
                      <button
                        className="recent-tag"
                        key={tagKey(tag)}
                        type="button"
                        onClick={() => addRecentTag(tag)}
                        disabled={!canEditTask || tags.some((item) => tagKey(item) === tagKey(tag)) || tags.length >= 6}
                      >
                        <span className="tag-color-dot" style={{ backgroundColor: tag.color }} aria-hidden="true" />
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="tag-list">
                {tags.map((tag) => (
                  <button
                    className="tag-pill"
                    key={tag.name + tag.color}
                    style={{ backgroundColor: tag.color }}
                    type="button"
                    onClick={() => setTags((current) => current.filter((item) => item !== tag))}
                    disabled={!canEditTask}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>

            {message && <p className="form-message">{message}</p>}
            {canManageTask && (
              <section className="share-section">
                <div>
                  <span className="label">Trabajo en grupo</span>
                  <h2>Invitar con QR</h2>
                </div>
                <label>
                  Permiso para nuevos usuarios
                  <select value={sharePermission} onChange={(event) => setSharePermission(event.target.value as "view" | "edit")}>
                    <option value="view">Solo visualizar</option>
                    <option value="edit">Visualizar y editar</option>
                  </select>
                </label>
                <button className="btn ghost" type="button" onClick={generateInvite}>Generar QR</button>
                {qrDataUrl && (
                  <div className="qr-box">
                    <img src={qrDataUrl} alt="QR para unirse a la tarea" />
                    <input value={shareUrl} readOnly aria-label="Enlace de invitacion" />
                  </div>
                )}
                {task.collaborators.length > 0 && (
                  <div className="collaborator-list">
                    {task.collaborators.map((collaborator) => {
                      const userId = collaboratorId(collaborator.user);
                      return (
                        <article className="collaborator-row" key={userId}>
                          <div>
                            <strong>{collaboratorName(collaborator.user)}</strong>
                            <span>{collaborator.permission === "edit" ? "Puede editar" : "Solo visualiza"}</span>
                          </div>
                          <select
                            value={collaborator.permission}
                            onChange={(event) => changeCollaboratorPermission(userId, event.target.value as "view" | "edit")}
                          >
                            <option value="view">Ver</option>
                            <option value="edit">Editar</option>
                          </select>
                          <button className="btn compact danger" type="button" onClick={() => askDeleteCollaborator(userId, collaboratorName(collaborator.user))}>Quitar</button>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
            <div className="button-row">
              <button className="btn primary" type="submit" disabled={saving || !canEditTask}>
                {saving ? "Guardando" : "Guardar cambios"}
              </button>
              <Link className="btn ghost" to="/dashboard">Cancelar</Link>
            </div>
          </form>
        )}
      </main>
      <ConfirmPanel
        open={!!confirm}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmText={confirm?.confirmText}
        tone={confirm?.tone}
        busy={confirmBusy}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
