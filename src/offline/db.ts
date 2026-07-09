import {openDB} from 'idb';

export type Status = "Pendiente" | "En Progreso" | "Completada";
export type TaskTag = {
    name: string;
    color: string;
};

export type TaskPermission = "owner" | "view" | "edit";
export type TaskType = "individual" | "group";
export type TaskUser = {
    _id?: string;
    id?: string;
    name?: string;
    email?: string;
    photoUrl?: string;
};
export type TaskCollaborator = {
    user: TaskUser | string;
    permission: "view" | "edit";
    joinedAt?: string;
};

export type LocalTask = {
    _id: string;
    title: string;
    description?: string;
    status: Status;
    tags: TaskTag[];
    type: TaskType;
    owner?: TaskUser | string;
    userPermission?: TaskPermission | null;
    canEdit?: boolean;
    canManage?: boolean;
    collaborators: TaskCollaborator[];
    invite?: {
        token?: string;
        permission?: "view" | "edit";
        active?: boolean;
        createdAt?: string;
    };
    clienteId?: string;
    createdAt?: string;
    deleted?: boolean;
    pending?: boolean;
};

type TaskData = Partial<Pick<LocalTask, "title" | "description" | "status" | "tags" | "type">>;

export type OutboxOp = 
    | {id: string; op: "create"; clienteId: string; data: LocalTask; ts: number}
    | {id: string; op: "update"; serverId?: string; clienteId?: string; data: TaskData; ts: number}
    | {id: string; op: "delete"; serverId?: string; clienteId?: string; ts: number};

type MetaRecord = {
    key: string;
    serverId: string;
};

type TodoDBSchema = {
    tasks: {key: string; value: LocalTask};
    outbox: {key: string; value: OutboxOp};
    meta: {key: string; value: MetaRecord};
};

let dbp: ReturnType<typeof openDB<TodoDBSchema>>;

export function db() {
    if (!dbp) {
        dbp = openDB<TodoDBSchema>("todo-pwa", 1, {
            upgrade(d) {
                d.createObjectStore("tasks", {keyPath: "_id"});
                d.createObjectStore("outbox", {keyPath: "id"});
                d.createObjectStore("meta", {keyPath: "key"});
            },
        });
    }
    return dbp;
}
export async function cacheTasks(list: LocalTask[]) {
    const tx = (await db()).transaction("tasks", "readwrite");
    const s = tx.objectStore("tasks");
    await s.clear();
    for (const t of list) await s.put(t);
    await tx.done;
}

export async function putTaskLocal(task: LocalTask){await (await db()).put("tasks", task);}
export async function getAllTasksLocal(){return (await (await db()).getAll("tasks")) || [];}
export async function getTaskLocal(id: string){return (await (await db()).get("tasks", id));}
export async function removeTaskLocal(id: string){await (await db()).delete("tasks", id);}

/** Promociona una tarea local a la versión del servidor */
export async function promoteLocalToServer(clienteId: string, serverId: string) {
    const d = await db();
    const t = await d.get("tasks", clienteId);
    if(t) {
        await d.delete("tasks", clienteId);
        t._id = serverId;
        t.pending = false;
        await d.put("tasks", t);
    }
}

export async function queue(op: OutboxOp) {await (await db()).put("outbox", op);}
export async function getOutbox() {return (await (await db()).getAll("outbox")) || [];}
export async function removeOutboxOp(id: string) {await (await db()).delete("outbox", id);}
export async function clearOutbox() {
    const tx = (await db()).transaction("outbox", "readwrite");
    await tx.objectStore("outbox").clear();
    await tx.done;
}

//MAPEO CLIENTEID->SERVERID
export async function setMapping(clienteId: string, serverId: string) {
    await (await db()).put("meta", {key: clienteId, serverId});
}

export async function getMapping(clienteId: string) {
    return (await (await db()).get("meta", clienteId))?.serverId;
}

export async function removeMapping(clienteId: string) {
    await (await db()).delete("meta", clienteId);
}
