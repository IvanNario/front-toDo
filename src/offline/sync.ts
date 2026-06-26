import {api} from '../api';

import {
    getOutbox,
    clearOutbox,
    setMapping,
    getMapping,
    removeTaskLocal,
    removeMapping,
    promoteLocalToServer,
    type Status,
} from './db';

let syncing = false; // Evita que se ejecute más de una sincronización a la vez
let lastSyncAt = 0; // Marca de tiempo de la última sincronización exitosa. Se usa para evitar sincronizaciones muy frecuentes.

export async function syncNow() {
    if (!navigator.onLine) return; // No tiene sentido intentar sincronizar si no hay conexión

    const now = Date.now();
    if (now - lastSyncAt < 1500) return; // Evita sincronizaciones muy frecuentes (menos de 5 segundos entre ellas)
    lastSyncAt = now;

    if (syncing) return; // Ya hay una sincronización en curso
    syncing = true;

    try{
        const ops = (await getOutbox()).sort((a, b) => a.ts - b.ts); // Ordena las operaciones por su marca de tiempo para procesarlas en orden
        if(ops.length === 0) return; // No hay operaciones pendientes, no es necesario sincronizar


        const toSync: Array<{
            clienteId: string;
            title: string;
            description: string;
            status: Status;
            tags: Array<{name: string; color: string}>;
        }> = [];
        for(const op of ops) {
            if(op.op === "create") {
                toSync.push({
                    clienteId: op.clienteId,
                    title: op.data.title,
                    description: op.data.description ?? "",
                    status: op.data.status ?? "Pendiente",
                    tags: op.data.tags,
                });
            }else if (op.op === "update") {
                // Para las actualizaciones, necesitamos el serverId para poder actualizar la tarea correcta en el servidor. Si no lo tenemos, es que la tarea aún no se ha creado en el servidor, así que la tratamos como una creación.
                const cid = op.clienteId;
                if(cid && op.data.title){
                    toSync.push({
                        clienteId: cid,
                        title: op.data.title,
                        description: op.data.description ?? "",
                        status: op.data.status ?? "Pendiente",
                        tags: op.data.tags ?? [],
                    });
            } else if (op.serverId) {
                try {
                    await api.put(`/tasks/${op.serverId}`, op.data);
                } catch {
                    // Si la actualización falla, no hacemos nada. La operación seguirá en la outbox y se intentará de nuevo en la próxima sincronización.

                }
            }
        }
    }
    
    if(toSync.length) {
        try{
            const {data} = await api.post("/tasks/bulksync", {tasks: toSync});
            const mapping = Array.isArray(data?.mapping) ? data.mapping : [];
            for (const map of mapping as Array<{clienteId: string; serverId: string}>) {
                await setMapping(map.clienteId, map.serverId);
                await promoteLocalToServer(map.clienteId, map.serverId);
            }
        }catch {
            // Si la sincronización falla, no hacemos nada. Las operaciones seguirán en la outbox y se intentará de nuevo en la próxima sincronización.
            return;
        }
    }

    // proceso deletes por separado porque no necesitan clienteId, solo serverId
    for(const op of ops) {
        if(op.op !== "delete") continue;
        const serverId = op.serverId ?? (op.clienteId ? await getMapping(op.clienteId) : undefined);
        if(!serverId) continue; // Si no tenemos un serverId, no podemos eliminar la tarea en el servidor, así que la dejamos para la próxima sincronización
        try{
            await api.delete(`/tasks/${serverId}`);
            await removeTaskLocal(op.clienteId || serverId); // Eliminamos la tarea localmente usando el clienteId si lo tenemos, o el serverId si no
            if (op.clienteId) await removeMapping(op.clienteId);
        }catch {
            // Si la eliminación falla, no hacemos nada. La operación seguirá en la outbox y se intentará de nuevo en la próxima sincronización.
        }
    }
    //si todo lo anterior se ha procesado sin errores, podemos limpiar la outbox
    await clearOutbox();
    } finally {
        syncing = false;
    }
}

