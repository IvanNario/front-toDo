import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { getTaskLocal, putTaskLocal, queue, type LocalTask, type Status, type TaskTag } from "../offline/db";
import { TAG_COLORS, asQueuedUpdate, isLocalId, normalizeTask } from "../tasks";

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

  useEffect(() => {
    void (async () => {
      try {
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
    if (!name || tags.length >= 6) return;
    setTags((current) => [...current, { name, color: tagColor }]);
    setTagName("");
  }

  async function saveTask(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !title.trim()) return;

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
    } catch {
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
            <label>
              Titulo
              <input value={title} onChange={(event) => setTitle(event.target.value)} required />
            </label>
            <label>
              Descripcion
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} />
            </label>
            <label>
              Estado
              <select value={status} onChange={(event) => setStatus(event.target.value as Status)}>
                <option value="Pendiente">Pendiente</option>
                <option value="En Progreso">En Progreso</option>
                <option value="Completada">Completada</option>
              </select>
            </label>

            <div className="tag-editor">
              <span className="label">Etiquetas</span>
              <div className="tag-builder">
                <input value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="Nombre de etiqueta" />
                <div className="color-picker" aria-label="Color de etiqueta">
                  {TAG_COLORS.map((color) => (
                    <button
                      className={tagColor === color ? "color-dot active" : "color-dot"}
                      key={color}
                      style={{ backgroundColor: color }}
                      type="button"
                      onClick={() => setTagColor(color)}
                      aria-label={`Color ${color}`}
                    />
                  ))}
                </div>
                <button className="btn ghost" type="button" onClick={addTag}>Agregar</button>
              </div>
              <div className="tag-list">
                {tags.map((tag) => (
                  <button
                    className="tag-pill"
                    key={tag.name + tag.color}
                    style={{ backgroundColor: tag.color }}
                    type="button"
                    onClick={() => setTags((current) => current.filter((item) => item !== tag))}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>

            {message && <p className="form-message">{message}</p>}
            <div className="button-row">
              <button className="btn primary" type="submit" disabled={saving}>
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
