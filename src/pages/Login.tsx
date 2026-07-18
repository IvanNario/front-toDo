import {useState} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import {api, setAuth} from '../api';
import logo from '../assets/logo.png';


export default function Login() {
    const nav = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [show, setShow] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        const cleanEmail = email.trim().toLowerCase();

        if (!cleanEmail || !password) {
            setError("Ingresa tu correo y contraseña");
            return;
        }

        setError("");
        setLoading(true);
        try{
            const {data} = await api.post("/auth/login", {email: cleanEmail, password});
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
            setError(message || "Error al iniciar sesión");
        }finally {
            setLoading(false);
        }
    }

    return (
        <div className="auth-wrap">
            <div className="card">   
                <div className="brand">
                    <img src={logo} alt="logo" className='logo-img'/>
                    <h2>Organize</h2>
                    <p className="muted">Organiza tus tareas con calma y claridad</p>
                </div>
                <form className="form" onSubmit={onSubmit}>
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
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
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
                    {error && <div className="alert">{error}</div>}

                    <button className="btn primary" disabled={loading}>
                        {loading ? "Iniciando sesión..." : "Iniciar sesión"}
                    </button>
                </form>
                <div className="footer-links">
                    <span className="muted">¿No tienes una cuenta?</span>
                    <Link to="/register" className="link">Regístrate aquí</Link>
                </div>
            </div>
        </div>
    );
}

