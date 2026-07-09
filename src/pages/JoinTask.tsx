import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api, setAuth } from "../api";
import { putTaskLocal } from "../offline/db";
import { normalizeTask } from "../tasks";

export default function JoinTask() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState("Uniendote a la tarea compartida...");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setAuth(localStorage.getItem("token"));

    void (async () => {
      try {
        const { data } = await api.post(`/tasks/invites/${token}/join`);
        const task = normalizeTask(data?.task ?? data);
        await putTaskLocal(task);
        setDone(true);
        setMessage("Ya te uniste a la tarea compartida.");
        window.setTimeout(() => navigate(`/tasks/${task._id}/edit`), 900);
      } catch (error) {
        const fallback = "No se pudo usar esta invitacion. Puede estar desactivada o la tarea ya finalizo.";
        setMessage((error as { response?: { data?: { message?: string } } }).response?.data?.message ?? fallback);
      }
    })();
  }, [navigate, token]);

  return (
    <div className="auth-wrap">
      <main className="card join-card">
        <div className="brand">
          <h2>{done ? "Tarea agregada" : "Invitacion de tarea"}</h2>
          <p className="muted">{message}</p>
        </div>
        <Link className="btn primary" to="/dashboard">Ir al dashboard</Link>
      </main>
    </div>
  );
}
