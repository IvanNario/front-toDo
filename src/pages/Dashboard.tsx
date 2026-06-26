import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, setAuth } from "../api";
import {
  cacheTasks,
  getAllTasksLocal,
  putTaskLocal,
  removeOutboxOp,
  removeTaskLocal,
  queue,
  type LocalTask,
  type Status,
  type TaskTag,
} from "../offline/db";
import { syncNow } from "../offline/sync";
import { TAG_COLORS, asQueuedUpdate, isLocalId, normalizeTask, now } from "../tasks";

type Filter = "all" | "active" | "completed";
type UserProfile = {
  name: string;
  email: string;
  photoUrl: string;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "U").concat(parts[1]?.[0] ?? "").toUpperCase();
}

async function fetchProfile(): Promise<UserProfile> {
  const { data } = await api.get("/auth/profile");
  return {
    name: String(data?.name ?? ""),
    email: String(data?.email ?? ""),
    photoUrl: String(data?.photoUrl ?? ""),
  };
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<TaskTag[]>([]);
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState(TAG_COLORS[0]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [online, setOnline] = useState(navigator.onLine);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [showWelcome, setShowWelcome] = useState(
    () => sessionStorage.getItem("showWelcome") === "1"
  );

  const loadFromServer = useCallback(async () => {
    try {
      const { data } = await api.get("/tasks");
      const raw = Array.isArray(data?.items) ? data.items : [];
      const list = raw.map(normalizeTask);
      setTasks(list);
      await cacheTasks(list);
    } catch {
      // Si falla el servidor, se mantiene la copia local.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setAuth(localStorage.getItem("token"));

    const onOnline = async () => {
      setOnline(true);
      await syncNow();
      await loadFromServer();
    };
    const onOffline = () => setOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    void (async () => {
      const local = await getAllTasksLocal();
      if (local.length) setTasks(local.map(normalizeTask));
      try {
        setUser(await fetchProfile());
      } catch {
        setUser(null);
      }
      await loadFromServer();
      await syncNow();
      await loadFromServer();
    })();

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [loadFromServer]);

  function addTag() {
    const name = tagName.trim();
    if (!name || tags.length >= 6) return;
    setTags((current) => [...current, { name, color: tagColor }]);
    setTagName("");
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    if (!trimmedTitle) return;

    const clienteId = crypto.randomUUID();
    const localTask = normalizeTask({
      _id: clienteId,
      title: trimmedTitle,
      description: trimmedDescription,
      status: "Pendiente",
      tags,
      pending: true,
    });

    setTasks((prev) => [localTask, ...prev]);
    await putTaskLocal(localTask);
    setTitle("");
    setDescription("");
    setTags([]);

    if (!navigator.onLine) {
      await queue({
        id: "op-" + clienteId,
        op: "create",
        clienteId,
        data: localTask,
        ts: now(),
      });
      return;
    }

    try {
      const { data } = await api.post("/tasks", {
        title: trimmedTitle,
        description: trimmedDescription,
        tags,
      });
      const created = normalizeTask(data?.task ?? data);
      setTasks((prev) => prev.map((task) => (task._id === clienteId ? created : task)));
      await removeTaskLocal(clienteId);
      await putTaskLocal(created);
    } catch {
      await queue({
        id: "op-" + clienteId,
        op: "create",
        clienteId,
        data: localTask,
        ts: now(),
      });
    }
  }

  async function handleStatusChange(task: LocalTask, status: Status) {
    const updated: LocalTask = {
      ...task,
      status,
      pending: isLocalId(task._id) || task.pending,
    };

    setTasks((prev) => prev.map((item) => (item._id === task._id ? updated : item)));
    await putTaskLocal(updated);

    if (!navigator.onLine || isLocalId(task._id)) {
      await queue(asQueuedUpdate(updated, { status }));
      return;
    }

    try {
      await api.put(`/tasks/${task._id}`, { status });
    } catch {
      await queue(asQueuedUpdate(updated, { status }));
    }
  }

  async function removeTask(task: LocalTask) {
    const backup = tasks;
    setTasks((prev) => prev.filter((item) => item._id !== task._id));
    await removeTaskLocal(task._id);

    if (isLocalId(task._id)) {
      await removeOutboxOp("op-" + task._id);
      await removeOutboxOp("upd-" + task._id);
      return;
    }

    if (!navigator.onLine) {
      await queue({
        id: "del-" + task._id,
        op: "delete",
        serverId: task._id,
        ts: now(),
      });
      return;
    }

    try {
      await api.delete(`/tasks/${task._id}`);
    } catch {
      setTasks(backup);
      for (const item of backup) await putTaskLocal(item);
      await queue({
        id: "del-" + task._id,
        op: "delete",
        serverId: task._id,
        ts: now(),
      });
    }
  }

  function logout() {
    localStorage.removeItem("token");
    sessionStorage.removeItem("showWelcome");
    setAuth(null);
    window.location.href = "/";
  }

  function closeWelcome() {
    sessionStorage.removeItem("showWelcome");
    setShowWelcome(false);
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return tasks.filter((task) => {
      const matchesText =
        !term ||
        task.title.toLowerCase().includes(term) ||
        (task.description ?? "").toLowerCase().includes(term) ||
        task.tags.some((tag) => tag.name.toLowerCase().includes(term));
      const matchesFilter =
        filter === "all" ||
        (filter === "active" && task.status !== "Completada") ||
        (filter === "completed" && task.status === "Completada");

      return matchesText && matchesFilter;
    });
  }, [tasks, search, filter]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((task) => task.status === "Completada").length;
    const progress = tasks.filter((task) => task.status === "En Progreso").length;
    const pending = tasks.filter((task) => task.status === "Pendiente").length;
    return { total, done, progress, pending };
  }, [tasks]);

  const oldestTasks = useMemo(() => {
    return tasks
      .filter((task) => task.status !== "Completada")
      .slice()
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      })
      .slice(0, 3);
  }, [tasks]);

  return (
    <div className="app-shell">
      {showWelcome && (
        <aside className="welcome-banner" aria-live="polite">
          <div>
            <strong>Bienvenido{user?.name ? `, ${user.name}` : ""}</strong>
            <span>Tu espacio de tareas esta listo para trabajar.</span>
          </div>
          <button className="welcome-close" type="button" onClick={closeWelcome} aria-label="Cerrar bienvenida">
            ×
          </button>
        </aside>
      )}
      <header className="topbar">
        <div>
          <p className="eyebrow">Panel de tareas</p>
          <h1>To-Do PWA</h1>
        </div>
        <nav className="nav-actions">
          <Link className="btn ghost" to="/profile">Perfil</Link>
          <span className={online ? "connection online" : "connection offline"}>
            {online ? "Online" : "Offline"}
          </span>
          <button className="btn danger subtle" type="button" onClick={logout}>
            Salir
          </button>
        </nav>
      </header>

      <main className="dashboard-grid">
        <section className="profile-panel">
          {user?.photoUrl ? (
            <img className="avatar photo" src={user.photoUrl} alt="Foto de perfil" />
          ) : (
            <div className="avatar" aria-hidden="true">{initials(user?.name ?? "")}</div>
          )}
          <div className="profile-copy">
            <span className="label">Perfil</span>
            <h2>{user?.name || "Usuario"}</h2>
            <p>{user?.email || "Cargando perfil"}</p>
            <Link className="btn ghost" to="/profile">Editar perfil</Link>
          </div>
        </section>

        <section className="stats-panel" aria-label="Resumen de tareas">
          <div><span>Total</span><strong>{stats.total}</strong></div>
          <div><span>Pendientes</span><strong>{stats.pending}</strong></div>
          <div><span>En progreso</span><strong>{stats.progress}</strong></div>
          <div><span>Hechas</span><strong>{stats.done}</strong></div>
        </section>

        <section className="reminder-panel" aria-label="Recordatorio de tareas antiguas">
          <div>
            <span className="label">Recordatorio</span>
            <h2>Tareas por priorizar</h2>
          </div>
          {oldestTasks.length === 0 ? (
            <p>Todas las tareas activas estan al dia.</p>
          ) : (
            <ul>
              {oldestTasks.map((task) => (
                <li key={task._id}>
                  <strong>{task.title}</strong>
                  <span>{task.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="task-panel">
          <form className="task-form" onSubmit={addTask}>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Nueva tarea" />
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descripcion opcional" rows={2} />
            <div className="tag-builder">
              <input value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="Etiqueta" />
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
              <button className="btn ghost" type="button" onClick={addTag}>Agregar etiqueta</button>
            </div>
            {tags.length > 0 && (
              <div className="tag-list">
                {tags.map((tag) => (
                  <button
                    key={tag.name + tag.color}
                    className="tag-pill"
                    style={{ backgroundColor: tag.color }}
                    type="button"
                    onClick={() => setTags((current) => current.filter((item) => item !== tag))}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            )}
            <button className="btn primary" type="submit">Agregar</button>
          </form>

          <div className="toolbar">
            <input className="search" placeholder="Buscar tareas o etiquetas" value={search} onChange={(event) => setSearch(event.target.value)} />
            <div className="filters">
              <button className={filter === "all" ? "chip active" : "chip"} onClick={() => setFilter("all")} type="button">Todas</button>
              <button className={filter === "active" ? "chip active" : "chip"} onClick={() => setFilter("active")} type="button">Activas</button>
              <button className={filter === "completed" ? "chip active" : "chip"} onClick={() => setFilter("completed")} type="button">Hechas</button>
            </div>
          </div>

          {loading ? (
            <p className="empty">Cargando...</p>
          ) : filtered.length === 0 ? (
            <p className="empty">Sin tareas por ahora</p>
          ) : (
            <ul className="task-list">
              {filtered.map((task) => (
                <li key={task._id} className={task.status === "Completada" ? "task-item done" : "task-item"}>
                  <select value={task.status} onChange={(event) => handleStatusChange(task, event.target.value as Status)} className="status-select" title="Estado">
                    <option value="Pendiente">Pendiente</option>
                    <option value="En Progreso">En Progreso</option>
                    <option value="Completada">Completada</option>
                  </select>

                  <div className="task-content">
                    <strong>{task.title}</strong>
                    {task.description && <p>{task.description}</p>}
                    {task.tags.length > 0 && (
                      <div className="tag-list">
                        {task.tags.map((tag) => <span className="tag-pill" style={{ backgroundColor: tag.color }} key={tag.name + tag.color}>{tag.name}</span>)}
                      </div>
                    )}
                    {(task.pending || isLocalId(task._id)) && <span className="sync-badge">Falta sincronizar</span>}
                  </div>

                  <div className="actions">
                    <Link className="btn compact ghost" to={`/tasks/${task._id}/edit`}>Editar</Link>
                    <button className="btn compact danger" type="button" onClick={() => removeTask(task)}>Eliminar</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
