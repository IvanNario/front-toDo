import { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { api } from "../api";

type ProfileData = {
  name: string;
  email: string;
  photoUrl: string;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "U").concat(parts[1]?.[0] ?? "").toUpperCase();
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(file);
  });
}

function isStrongEnough(password: string) {
  return password.length >= 8 && /[a-zA-Z]/.test(password) && /\d/.test(password);
}

export default function Profile() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [name, setName] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await api.get("/auth/profile");
        const nextProfile = {
          name: String(data?.name ?? ""),
          email: String(data?.email ?? ""),
          photoUrl: String(data?.photoUrl ?? ""),
        };
        setProfile(nextProfile);
        setName(nextProfile.name);
        setPhotoUrl(nextProfile.photoUrl);
      } catch {
        setProfileMessage("No se pudo cargar el perfil");
      }
    })();
  }, []);

  async function onPhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setProfileMessage("Selecciona una imagen PNG, JPG o WEBP");
      return;
    }

    if (file.size > 220000) {
      setProfileMessage("Usa una imagen menor a 220 KB");
      return;
    }

    try {
      setPhotoUrl(await fileToDataUrl(file));
      setProfileMessage("");
    } catch {
      setProfileMessage("No se pudo cargar la imagen");
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 60) {
      setProfileMessage("El nombre debe tener entre 2 y 60 caracteres");
      return;
    }

    setSavingProfile(true);
    setProfileMessage("");
    try {
      const { data } = await api.patch("/auth/profile", {
        name: trimmedName,
        photoUrl,
      });
      const nextProfile = {
        name: String(data?.name ?? trimmedName),
        email: String(data?.email ?? profile?.email ?? ""),
        photoUrl: String(data?.photoUrl ?? photoUrl),
      };
      setProfile(nextProfile);
      setName(nextProfile.name);
      setPhotoUrl(nextProfile.photoUrl);
      setProfileMessage("Perfil actualizado");
    } catch (err: unknown) {
      const message = axios.isAxiosError(err) ? err.response?.data?.message : undefined;
      setProfileMessage(message || "No se pudo guardar el perfil");
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordMessage("");

    if (!isStrongEnough(newPassword)) {
      setPasswordMessage("La nueva contraseña debe tener al menos 8 caracteres, una letra y un numero");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage("Las contraseñas no coinciden");
      return;
    }

    setSavingPassword(true);
    try {
      await api.patch("/auth/profile/password", {
        currentPassword,
        newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("Contraseña actualizada");
    } catch (err: unknown) {
      const message = axios.isAxiosError(err) ? err.response?.data?.message : undefined;
      setPasswordMessage(message || "No se pudo cambiar la contraseña");
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="app-shell narrow-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Perfil</p>
          <h1>Editar perfil</h1>
        </div>
        <Link className="btn ghost" to="/dashboard">Volver</Link>
      </header>

      <main className="profile-grid">
        <section className="section-card">
          <div className="profile-preview">
            {photoUrl ? (
              <img className="avatar photo large" src={photoUrl} alt="Foto de perfil" />
            ) : (
              <div className="avatar large" aria-hidden="true">{initials(name)}</div>
            )}
            <div>
              <h2>{profile?.name || "Usuario"}</h2>
              <p>{profile?.email || "Cargando correo"}</p>
            </div>
          </div>

          <form className="detail-form" onSubmit={saveProfile}>
            <label>
              Nombre
              <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={60} autoComplete="name" required />
            </label>
            <label>
              Foto personalizada
              <input type="file" accept="image/*" onChange={onPhotoChange} />
            </label>
            {photoUrl && (
              <button className="btn ghost" type="button" onClick={() => setPhotoUrl("")}>
                Quitar foto
              </button>
            )}
            {profileMessage && <p className="form-message">{profileMessage}</p>}
            <button className="btn primary" type="submit" disabled={savingProfile}>
              {savingProfile ? "Guardando" : "Guardar perfil"}
            </button>
          </form>
        </section>

        <section className="section-card">
          <span className="label">Seguridad</span>
          <h2>Cambiar contraseña</h2>
          <form className="detail-form" onSubmit={savePassword}>
            <label>
              Contraseña actual
              <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
            </label>
            <label>
              Nueva contraseña
              <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} autoComplete="new-password" required />
            </label>
            <label>
              Confirmar contraseña
              <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} autoComplete="new-password" required />
            </label>
            {passwordMessage && <p className="form-message">{passwordMessage}</p>}
            <button className="btn primary" type="submit" disabled={savingPassword}>
              {savingPassword ? "Actualizando" : "Cambiar contraseña"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
