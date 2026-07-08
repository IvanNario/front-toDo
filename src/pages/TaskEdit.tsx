import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { getAllTasksLocal, getTaskLocal, putTaskLocal, queue, type LocalTask, type Status, type TaskTag } from "../offline/db";
import { TAG_COLORS, asQueuedUpdate, isLocalId, normalizeTask } from "../tasks";

const STATUS_OPTIONS: Status[] = ["Pendiente", "En Progreso", "Completada"];

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

export default function TaskEdit() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState<LocalTask | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Status>("Pendiente");
  const [tags, setTags] = useState<TaskTag[]>([]);
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState(TAG_COLORS[0]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [recentTags, setRecentTags] = useState<TaskTag[]>([]);

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
          setTags(normalized.tags);
          return;
        }

        const { data } = await api.get(`/tasks/${id}`);
        const remote = normalizeTask(data?.task ?? data);
        setTask(remote);
        setTitle(remote.title);
        setDescription(remote.description ?? "");
        setStatus(remote.status);
        setTags(remote.tags);
      } catch {
        setMessage("No se pudo cargar la tarea");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  function addTag() {
    const name = tagName.trim();
    if (!name || tags.length >= 6 || tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) return;
    setTags((current) => [...current, { name, color: tagColor }]);
    setTagName("");
  }

  function addRecentTag(tag: TaskTag) {
    if (tags.length >= 6 || tags.some((item) => tagKey(item) === tagKey(tag))) return;
    setTags((current) => [...current, tag]);
  }

  async function saveTask(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !title.trim()) return;
    if (task.status === "Completada") {
      setMessage("Esta tarea ya fue completada y no se puede editar.");
      return;
    }

    const patched: LocalTask = {
      ...task,
      title: title.trim(),
      description: description.trim(),
      status,
      tags,
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
          <p className="empty">Cargando tarea...</p>
        ) : !task ? (
          <p className="empty">{message || "Tarea no encontrada"}</p>
        ) : (
          <form className="detail-form" onSubmit={saveTask}>
            {taskCompleted && (
              <p className="form-message">Esta tarea ya fue completada y queda bloqueada para edicion.</p>
            )}
            <label>
              Titulo
              <input value={title} onChange={(event) => setTitle(event.target.value)} required disabled={taskCompleted} />
            </label>
            <label>
              Descripcion
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} disabled={taskCompleted} />
            </label>
            <label>
              Estado
              <select value={status} onChange={(event) => setStatus(event.target.value as Status)} disabled={taskCompleted}>
                {STATUS_OPTIONS.map((option) => <option value={option} key={option}>{option}</option>)}
              </select>
            </label>

            <div className="tag-editor" aria-disabled={taskCompleted}>
              <span className="label">Etiquetas</span>
              <div className="tag-builder">
                <input value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="Nombre de etiqueta" disabled={taskCompleted} />
                <div className="color-picker" aria-label="Color de etiqueta">
                  {TAG_COLORS.map((color) => (
                    <button
                      className={tagColor === color ? "color-dot active" : "color-dot"}
                      key={color}
                      style={{ backgroundColor: color }}
                      type="button"
                      onClick={() => setTagColor(color)}
                      aria-label="Seleccionar color de etiqueta"
                      disabled={taskCompleted}
                    />
                  ))}
                </div>
                <button className="btn ghost" type="button" onClick={addTag} disabled={taskCompleted}>Agregar</button>
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
                        disabled={taskCompleted || tags.some((item) => tagKey(item) === tagKey(tag)) || tags.length >= 6}
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
                    disabled={taskCompleted}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>

            {message && <p className="form-message">{message}</p>}
            <div className="button-row">
              <button className="btn primary" type="submit" disabled={saving || taskCompleted}>
                {saving ? "Guardando" : "Guardar cambios"}
              </button>
              <Link className="btn ghost" to="/dashboard">Cancelar</Link>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
