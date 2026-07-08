import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const STATUS_OPTIONS: Status[] = ["Pendiente", "En Progreso", "Completada"];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "U").concat(parts[1]?.[0] ?? "").toUpperCase();
}

function tagKey(tag: TaskTag) {
  return `${tag.name.trim().toLowerCase()}-${tag.color}`;
}

function formatTaskAge(createdAt?: string) {
  if (!createdAt) return "Sin fecha registrada";
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return "Sin fecha registrada";

  const diff = Math.max(0, Date.now() - created);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Creada hace unos segundos";
  if (minutes < 60) return `Creada hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Creada hace ${hours} h`;

  const days = Math.floor(hours / 24);
  return `Creada hace ${days} dia${days === 1 ? "" : "s"}`;
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
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => typeof Notification !== "undefined" && Notification.permission === "granted"
  );
  const notifiedTasks = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    const interval = window.setInterval(() => setClockTick(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);

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

  async function enableNotifications() {
    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    setNotificationsEnabled(permission === "granted");
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
    if (task.status === "Completada") return;

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
    } catch (error) {
      if ((error as { response?: { status?: number } }).response?.status === 409) {
        await loadFromServer();
        return;
      }
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

  const recentTags = useMemo(() => {
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

  useEffect(() => {
    if (!notificationsEnabled || typeof Notification === "undefined") return;

    const nextTask = oldestTasks[0];
    if (!nextTask || notifiedTasks.current.has(nextTask._id)) return;

    notifiedTasks.current.add(nextTask._id);
    new Notification("Tarea antigua pendiente", {
      body: `${nextTask.title} - ${nextTask.status}`,
      icon: "/icon-192.png",
      tag: `old-task-${nextTask._id}`,
    });
  }, [clockTick, notificationsEnabled, oldestTasks]);

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

        <section className="notification-panel" aria-label="Notificaciones de tareas antiguas" aria-live="polite">
          <div className="panel-heading">
            <div>
              <span className="label">Notificaciones</span>
              <h2>Tareas por priorizar</h2>
            </div>
            {typeof Notification !== "undefined" && (
              <button className="btn compact ghost" type="button" onClick={enableNotifications}>
                {notificationsEnabled ? "Avisos activos" : "Activar avisos"}
              </button>
            )}
          </div>
          {oldestTasks.length === 0 ? (
            <p>Todas las tareas activas estan al dia.</p>
          ) : (
            <ul className="notification-list">
              {oldestTasks.map((task) => (
                <li key={task._id}>
                  <div>
                    <strong>{task.title}</strong>
                    <small>{formatTaskAge(task.createdAt)}</small>
                  </div>
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
                    aria-label="Seleccionar color de etiqueta"
                  />
                ))}
              </div>
              <button className="btn ghost" type="button" onClick={addTag}>Agregar etiqueta</button>
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
                      disabled={tags.some((item) => tagKey(item) === tagKey(tag)) || tags.length >= 6}
                    >
                      <span className="tag-color-dot" style={{ backgroundColor: tag.color }} aria-hidden="true" />
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
              {filtered.map((task) => {
                const completed = task.status === "Completada";

                return (
                  <li key={task._id} className={completed ? "task-item done" : "task-item"}>
                    <div className="status-control" aria-label={`Estado de ${task.title}`}>
                      {STATUS_OPTIONS.map((option) => (
                        <button
                          className={task.status === option ? "status-chip active" : "status-chip"}
                          key={option}
                          type="button"
                          aria-pressed={task.status === option}
                          disabled={completed}
                          onClick={() => handleStatusChange(task, option)}
                        >
                          {option}
                        </button>
                      ))}
                    </div>

                    <div className="task-content">
                      <strong>{task.title}</strong>
                      {task.description && <p>{task.description}</p>}
                      {task.tags.length > 0 && (
                        <div className="tag-list">
                          {task.tags.map((tag) => <span className="tag-pill" style={{ backgroundColor: tag.color }} key={tag.name + tag.color}>{tag.name}</span>)}
                        </div>
                      )}
                      {completed && <span className="task-locked">Completada y bloqueada</span>}
                      {(task.pending || isLocalId(task._id)) && <span className="sync-badge">Falta sincronizar</span>}
                    </div>

                    <div className="actions">
                      {completed ? (
                        <span className="task-locked action-lock">Sin edición</span>
                      ) : (
                        <Link className="btn compact ghost" to={`/tasks/${task._id}/edit`}>Editar</Link>
                      )}
                      <button className="btn compact danger" type="button" onClick={() => removeTask(task)}>Eliminar</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
