import type { LocalTask, TaskCollaborator, TaskPermission, TaskTag, TaskType, TaskUser } from "./offline/db";

export const TAG_COLORS = ["#ff721f", "#345b45", "#f4a261", "#7c9a62"];

export const isLocalId = (id: string) => !/^[a-f0-9]{24}$/i.test(id);
export const now = () => Number(new Date());

export type TaskPatch = Partial<Pick<LocalTask, "title" | "description" | "status" | "tags" | "type">>;

function normalizeUser(value: unknown): TaskUser | string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return undefined;

  const user = value as Record<string, unknown>;
  return {
    _id: typeof user._id === "string" ? user._id : undefined,
    id: typeof user.id === "string" ? user.id : undefined,
    name: typeof user.name === "string" ? user.name : undefined,
    email: typeof user.email === "string" ? user.email : undefined,
    photoUrl: typeof user.photoUrl === "string" ? user.photoUrl : undefined,
  };
}

function normalizeCollaborators(value: unknown): TaskCollaborator[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      const collaborator = typeof item === "object" && item !== null
        ? (item as Record<string, unknown>)
        : {};
      const permission: "view" | "edit" = collaborator.permission === "edit" ? "edit" : "view";

      return {
        user: normalizeUser(collaborator.user) ?? "",
        permission,
        joinedAt: typeof collaborator.joinedAt === "string" ? collaborator.joinedAt : undefined,
      };
    })
    .filter((item) => item.user);
}

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
  const type: TaskType = x.type === "group" ? "group" : "individual";
  const permission: TaskPermission | null =
    x.userPermission === "owner" || x.userPermission === "edit" || x.userPermission === "view"
      ? x.userPermission
      : null;
  const fallbackPermission: TaskPermission | null =
    permission ?? (x.canEdit === undefined && x.canManage === undefined ? "owner" : null);
  const invite = typeof x.invite === "object" && x.invite !== null
    ? (x.invite as Record<string, unknown>)
    : {};

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
    type,
    owner: normalizeUser(x.owner ?? x.user),
    userPermission: fallbackPermission,
    canEdit: typeof x.canEdit === "boolean" ? x.canEdit : fallbackPermission === "owner",
    canManage: typeof x.canManage === "boolean" ? x.canManage : fallbackPermission === "owner",
    collaborators: normalizeCollaborators(x.collaborators),
    invite: invite.token
      ? {
          token: String(invite.token),
          permission: invite.permission === "edit" ? "edit" : "view",
          active: invite.active === true,
          createdAt: typeof invite.createdAt === "string" ? invite.createdAt : undefined,
        }
      : undefined,
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
        type: data.type ?? task.type,
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
