import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import '../../styles/ui-kit.css';

type ToastType = 'success' | 'error' | 'info';

interface ToastAlertProps {
  type: ToastType;
  message: string;
  onClose?: () => void;
  actionLabel?: string;
  onAction?: () => void;
}

const iconMap = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info
} as const;

export const ToastAlert = ({ type, message, onClose, actionLabel, onAction }: ToastAlertProps) => {
  const Icon = iconMap[type];

  return (
    <div className={`ui-toast ui-toast-${type}`} role={type === 'error' ? 'alert' : 'status'} aria-live="polite">
      <div className="ui-toast-main">
        <Icon size={16} className="ui-toast-icon" />
        <span>{message}</span>
      </div>
      <div className="ui-toast-actions">
        {actionLabel && onAction && (
          <button type="button" className="btn-secondary ui-toast-action-btn" onClick={onAction}>
            {actionLabel}
          </button>
        )}
        {onClose && (
          <button type="button" className="ui-toast-close" onClick={onClose} aria-label="Cerrar mensaje">
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
};
