import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "primary";
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Konfirmasi",
  cancelLabel = "Batal",
  variant = "danger",
  onConfirm,
  onClose,
  busy,
}: Props) {
  const iconColor =
    variant === "danger" ? "text-rose-600 bg-rose-50"
    : variant === "warning" ? "text-amber-600 bg-amber-50"
    : "text-blue-600 bg-blue-50";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
          <Button variant={variant === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? "Memproses..." : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconColor}`}>
          <AlertTriangle size={20} />
        </div>
        <p className="text-sm text-slate-600 pt-1">{message}</p>
      </div>
    </Modal>
  );
}
