import {useState} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import {api, setAuth} from '../api';
import logo from '../assets/logo.png';


export default function Register() {
    const nav = useNavigate();
    const [name , setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [show, setShow] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        const cleanName = name.trim();
        const cleanEmail = email.trim().toLowerCase();

        if (cleanName.length < 2) {
            setError("Ingresa un nombre valido");
            return;
        }

        if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
            setError("La contraseña debe tener al menos 8 caracteres, una letra y un numero");
            return;
        }

        setError(""); setLoading(true);
        try{
            const {data} = await api.post("/auth/register", {name: cleanName, email: cleanEmail, password});
            localStorage.setItem("token", data.token);
            sessionStorage.setItem("showWelcome", "1");
            setAuth(data.token);
            const pendingInvitePath = sessionStorage.getItem("pendingInvitePath");
            if (pendingInvitePath) {
                sessionStorage.removeItem("pendingInvitePath");
                nav(pendingInvitePath);
            } else {
                nav("/dashboard");
            }
        }catch (err: unknown) {
            const message = axios.isAxiosError(err)
                ? err.response?.data?.message
                : undefined;
            setError(message || "Error al registrarte, inténtalo de nuevo");
        }finally {
            setLoading(false);
        }
    }

    return (
        <div className="auth-wrap">
            <div className="card">
                <div className="brand">
                    <img src={logo} alt="Logo" className="logo-img" />
                    <h2>Organize</h2>
                    <p className="muted">Crea tu espacio de tareas y prioridades</p>
                </div>
                <form className="form" onSubmit={onSubmit}>
                    <label>Nombre completo</label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ingresa tu nombre"
                        minLength={2}
                        maxLength={60}
                        autoComplete="name"
                        required
                    />
                    <label> Correo electrónico </label>
                    <input
                        type="email"
                        placeholder="Ingresa tu correo electrónico"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="email"
                        required
                    />
                    <label>Contraseña</label>
                    <div className="pass">
                        <input
                            type={show ? "text" : "password"}
                            placeholder="Ingresa tu contraseña"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            minLength={8}
                            autoComplete="new-password"
                            required
                        />
                        <button
                            type="button"
                            className="btn ghost password-toggle"
                            onClick={() => setShow((s) => !s)}
                            aria-label="Mostrar/ocultar contraseña"
                            aria-pressed={show}
                        >
                            {show ? "Ocultar" : "Mostrar"}
                        </button>
                    </div>
                    {error && <p className="error">{error}</p>}
                    <button className="btn primary" type="submit" disabled={loading}>
                        {loading ? "Registrando..." : "Registrarse"}
                    </button>
                    <p className="muted">¿Ya tienes una cuenta? <Link to="/">Inicia sesión</Link></p>
                </form>
            </div>
        </div>
    );
}
