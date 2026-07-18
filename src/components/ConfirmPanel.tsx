type ConfirmPanelProps = {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "danger" | "neutral";
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export default function ConfirmPanel({
  open,
  title,
  message,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  tone = "neutral",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmPanelProps) {
  if (!open) return null;

  return (
    <div className="confirm-layer">
      <aside className={`confirm-panel ${tone}`} role="dialog" aria-live="polite" aria-label={title}>
        <div>
          <span className="label">Confirmacion</span>
          <h2>{title}</h2>
          <p>{message}</p>
        </div>
        <div className="button-row">
          <button className="btn ghost" type="button" onClick={onCancel} disabled={busy}>
            {cancelText}
          </button>
          <button className={`btn ${tone === "danger" ? "danger" : "primary"}`} type="button" onClick={onConfirm} disabled={busy}>
            {busy ? "Procesando" : confirmText}
          </button>
        </div>
      </aside>
    </div>
  );
}
