import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { api, setAuth } from "../api";
import ConfirmPanel from "../components/ConfirmPanel";
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
  type TaskType,
} from "../offline/db";
import { syncNow } from "../offline/sync";
import {
  getCurrentPushSubscription,
  isPushSupported,
  sendTestPushNotification,
  subscribeToPushNotifications,
} from "../push";
import {
  DEFAULT_TAG_COLOR,
  TASK_LIMITS,
  asQueuedUpdate,
  cleanTaskText,
  isLocalId,
  normalizeTagColor,
  normalizeTask,
  now,
  validateTaskDraft,
} from "../tasks";

type Filter = "all" | "active" | "completed";
type UserProfile = {
  name: string;
  email: string;
  photoUrl: string;
};
type ConfirmState = {
  title: string;
  message: string;
  confirmText: string;
  tone?: "danger" | "neutral";
  onConfirm: () => void | Promise<void>;
};

const STATUS_OPTIONS: Status[] = ["Pendiente", "En Progreso", "Completada"];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "U").concat(parts[1]?.[0] ?? "").toUpperCase();
}

function tagKey(tag: TaskTag) {
  return `${tag.name.trim().toLowerCase()}-${tag.color}`;
}

function formatTaskAge(createdAt: string | undefined, referenceTime: number) {
  if (!createdAt) return "Sin fecha registrada";
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return "Sin fecha registrada";

  const diff = Math.max(0, referenceTime - created);
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
  const [taskType, setTaskType] = useState<TaskType>("individual");
  const [tags, setTags] = useState<TaskTag[]>([]);
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState(DEFAULT_TAG_COLOR);
  const [formMessage, setFormMessage] = useState("");
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
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState("");
  const [shareTask, setShareTask] = useState<LocalTask | null>(null);
  const [sharePermission, setSharePermission] = useState<"view" | "edit">("view");
  const [shareUrl, setShareUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

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

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (navigator.onLine) void loadFromServer();
    }, 8000);
    return () => window.clearInterval(interval);
  }, [loadFromServer]);

  useEffect(() => {
    if (!isPushSupported()) return;

    void getCurrentPushSubscription()
      .then((subscription) => {
        setNotificationsEnabled(Notification.permission === "granted" && !!subscription);
      })
      .catch(() => {
        setNotificationsEnabled(false);
      });
  }, []);

  function addTag() {
    const name = cleanTaskText(tagName, TASK_LIMITS.tagNameMax);
    setFormMessage("");

    if (name.length < TASK_LIMITS.tagNameMin) {
      setFormMessage(`La etiqueta debe tener al menos ${TASK_LIMITS.tagNameMin} caracteres.`);
      return;
    }

    if (tags.length >= TASK_LIMITS.tagsMax) {
      setFormMessage(`Solo puedes agregar hasta ${TASK_LIMITS.tagsMax} etiquetas.`);
      return;
    }

    if (tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) {
      setFormMessage("Esa etiqueta ya esta agregada.");
      return;
    }

    setTags((current) => [...current, { name, color: normalizeTagColor(tagColor) }]);
    setTagName("");
  }

  function addRecentTag(tag: TaskTag) {
    if (tags.length >= 6 || tags.some((item) => tagKey(item) === tagKey(tag))) return;
    setTags((current) => [...current, tag]);
  }

  async function enableNotifications() {
    setPushBusy(true);
    setPushMessage("");

    try {
      await subscribeToPushNotifications();
      setNotificationsEnabled(true);
      setPushMessage("Avisos push activados en este dispositivo.");
      await sendTestPushNotification();
    } catch (error) {
      setNotificationsEnabled(false);
      setPushMessage(error instanceof Error ? error.message : "No se pudieron activar los avisos push.");
    } finally {
      setPushBusy(false);
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = cleanTaskText(title, TASK_LIMITS.titleMax);
    const trimmedDescription = cleanTaskText(description, TASK_LIMITS.descriptionMax);
    const cleanTags = tags.map((tag) => ({
      name: cleanTaskText(tag.name, TASK_LIMITS.tagNameMax),
      color: normalizeTagColor(tag.color),
    }));
    const validation = validateTaskDraft(trimmedTitle, trimmedDescription, cleanTags);

    if (validation) {
      setFormMessage(validation);
      return;
    }

    setFormMessage("");

    const clienteId = crypto.randomUUID();
    const localTask = normalizeTask({
      _id: clienteId,
      title: trimmedTitle,
      description: trimmedDescription,
      status: "Pendiente",
      type: taskType,
      tags: cleanTags,
      pending: true,
    });

    setTasks((prev) => [localTask, ...prev]);
    await putTaskLocal(localTask);
    setTitle("");
    setDescription("");
    setTaskType("individual");
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
        type: taskType,
        tags: cleanTags,
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
    if (task.status === "Completada" || !task.canEdit) return;

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
    if (!task.canManage) return;

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

  function askLogout() {
    setConfirm({
      title: "Cerrar sesion",
      message: "Se cerrara la sesion en este dispositivo. Tus tareas sincronizadas seguiran protegidas en tu cuenta.",
      confirmText: "Salir",
      tone: "neutral",
      onConfirm: logout,
    });
  }

  function askRemoveTask(task: LocalTask) {
    setConfirm({
      title: "Eliminar tarea",
      message: `La tarea "${task.title}" se quitara de tu cuenta. Esta accion no modifica otras tareas.`,
      confirmText: "Eliminar",
      tone: "danger",
      onConfirm: () => removeTask(task),
    });
  }

  async function runConfirm() {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await confirm.onConfirm();
      setConfirm(null);
    } catch {
      setFormMessage("No se pudo completar la accion. Revisa tu conexion e intenta de nuevo.");
    } finally {
      setConfirmBusy(false);
    }
  }

  function closeWelcome() {
    sessionStorage.removeItem("showWelcome");
    setShowWelcome(false);
  }

  async function openShare(task: LocalTask) {
    setShareTask(task);
    setSharePermission(task.invite?.permission ?? "view");
    setShareUrl("");
    setQrDataUrl("");
    setShareMessage("");
  }

  async function generateInvite() {
    if (!shareTask) return;
    setShareMessage("");

    try {
      const { data } = await api.post(`/tasks/${shareTask._id}/invite`, { permission: sharePermission });
      const token = String(data?.token ?? "");
      const url = `${window.location.origin}/join/${token}`;
      setShareUrl(url);
      setQrDataUrl(await QRCode.toDataURL(url, { margin: 2, width: 220, color: { dark: "#000000", light: "#f2f2f2" } }));
      await loadFromServer();
    } catch (error) {
      setShareMessage((error as { response?: { data?: { message?: string } } }).response?.data?.message ?? "No se pudo generar el QR.");
    }
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
          <h1>Organize</h1>
        </div>
        <nav className="nav-actions">
          <Link className="btn ghost" to="/profile">Perfil</Link>
          <span className={online ? "connection online" : "connection offline"}>
            {online ? "Online" : "Offline"}
          </span>
          <button className="btn danger subtle" type="button" onClick={askLogout}>
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
            {isPushSupported() && (
              <button className="btn compact ghost" type="button" onClick={enableNotifications} disabled={pushBusy}>
                {pushBusy ? "Activando" : notificationsEnabled ? "Avisos activos" : "Activar avisos"}
              </button>
            )}
          </div>
          {pushMessage && <p className="push-message">{pushMessage}</p>}
          {oldestTasks.length === 0 ? (
            <p>Todas las tareas activas estan al dia.</p>
          ) : (
            <ul className="notification-list">
              {oldestTasks.map((task) => (
                <li key={task._id}>
                  <div>
                    <strong>{task.title}</strong>
                    <small>{formatTaskAge(task.createdAt, clockTick)}</small>
                  </div>
                  <span>{task.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="task-panel">
          <form className="task-form" onSubmit={addTask}>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Nueva tarea" minLength={TASK_LIMITS.titleMin} maxLength={TASK_LIMITS.titleMax} required />
            <select value={taskType} onChange={(event) => setTaskType(event.target.value as TaskType)} aria-label="Tipo de tarea">
              <option value="individual">Individual</option>
              <option value="group">Grupo</option>
            </select>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descripcion opcional" rows={2} maxLength={TASK_LIMITS.descriptionMax} />
            <div className="tag-builder">
              <input value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="Etiqueta" maxLength={TASK_LIMITS.tagNameMax} />
              <div className="color-picker" aria-label="Color de etiqueta">
                <span className="color-preview" style={{ backgroundColor: normalizeTagColor(tagColor) }} aria-hidden="true" />
                <input
                  className="color-input"
                  type="color"
                  value={normalizeTagColor(tagColor)}
                  onChange={(event) => setTagColor(normalizeTagColor(event.target.value))}
                  aria-label="Elegir color de etiqueta"
                />
              </div>
              <button className="btn ghost" type="button" onClick={addTag}>Agregar etiqueta</button>
            </div>
            {formMessage && <p className="form-message">{formMessage}</p>}
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
            <p className="empty loading-state">Cargando...</p>
          ) : filtered.length === 0 ? (
            <p className="empty">Sin tareas por ahora</p>
          ) : (
            <ul className="task-list">
              {filtered.map((task) => {
                const completed = task.status === "Completada";

                return (
                  <li
                    key={task._id}
                    className={completed ? "task-item done" : "task-item"}
                    style={{ "--folder-color": normalizeTagColor(task.tags[0]?.color ?? DEFAULT_TAG_COLOR) } as CSSProperties}
                  >
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
                      <div className="task-meta">
                        <span>{task.type === "group" ? "Grupal" : "Individual"}</span>
                        <span>{task.userPermission === "owner" ? "Dueño" : task.userPermission === "edit" ? "Puede editar" : "Solo lectura"}</span>
                      </div>
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
                        <>
                          {task.canEdit && <Link className="btn compact ghost" to={`/tasks/${task._id}/edit`}>Editar</Link>}
                          {task.canManage && (
                            <button className="btn compact ghost" type="button" onClick={() => openShare(task)}>QR</button>
                          )}
                        </>
                      )}
                      {task.canManage && !completed && <button className="btn compact danger" type="button" onClick={() => askRemoveTask(task)}>Eliminar</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
      {shareTask && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Compartir tarea">
          <section className="share-modal">
            <div className="panel-heading">
              <div>
                <span className="label">Compartir QR</span>
                <h2>{shareTask.title}</h2>
              </div>
              <button className="welcome-close" type="button" onClick={() => setShareTask(null)} aria-label="Cerrar">
                ×
              </button>
            </div>

            <label className="permission-field">
              Permiso para quien escanee
              <select value={sharePermission} onChange={(event) => setSharePermission(event.target.value as "view" | "edit")}>
                <option value="view">Solo visualizar</option>
                <option value="edit">Visualizar y editar</option>
              </select>
            </label>

            <button className="btn primary" type="button" onClick={generateInvite}>Generar QR</button>
            {shareMessage && <p className="form-message">{shareMessage}</p>}

            {qrDataUrl && (
              <div className="qr-box">
                <img src={qrDataUrl} alt="QR para unirse a la tarea" />
                <input value={shareUrl} readOnly aria-label="Enlace de invitacion" />
              </div>
            )}
          </section>
        </div>
      )}
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
