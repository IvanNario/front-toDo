import type { LocalTask, TaskTag } from "./offline/db";

export const TAG_COLORS = ["#ff721f", "#345b45", "#f4a261", "#7c9a62"];

export const isLocalId = (id: string) => !/^[a-f0-9]{24}$/i.test(id);
export const now = () => Number(new Date());

export type TaskPatch = Partial<Pick<LocalTask, "title" | "description" | "status" | "tags">>;

export function normalizeTags(value: unknown): TaskTag[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      const tag = typeof item === "object" && item !== null
        ? (item as Record<string, unknown>)
        : {};

      return {
        name: String(tag.name ?? "").trim().slice(0, 24),
        color: TAG_COLORS.includes(String(tag.color)) ? String(tag.color) : TAG_COLORS[0],
      };
    })
    .filter((tag) => tag.name)
    .slice(0, 6);
}

export function normalizeTask(value: unknown): LocalTask {
  const x = typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
  const status = x.status;

  return {
    _id: String(x._id ?? x.id ?? crypto.randomUUID()),
    title: String(x.title ?? "(sin titulo)"),
    description: typeof x.description === "string" ? x.description : "",
    status:
      status === "Completada" ||
      status === "En Progreso" ||
      status === "Pendiente"
        ? status
        : "Pendiente",
    tags: normalizeTags(x.tags),
    clienteId: typeof x.clienteId === "string" ? x.clienteId : undefined,
    createdAt: typeof x.createdAt === "string" ? x.createdAt : undefined,
    deleted: !!x.deleted,
    pending: !!x.pending,
  };
}

export function asQueuedUpdate(task: LocalTask, data: TaskPatch) {
  if (isLocalId(task._id)) {
    return {
      id: "upd-" + task._id,
      op: "update" as const,
      clienteId: task._id,
      data: {
        title: data.title ?? task.title,
        description: data.description ?? task.description ?? "",
        status: data.status ?? task.status,
        tags: data.tags ?? task.tags,
      },
      ts: now(),
    };
  }

  return {
    id: "upd-" + task._id,
    op: "update" as const,
    serverId: task._id,
    data,
    ts: now(),
  };
}
