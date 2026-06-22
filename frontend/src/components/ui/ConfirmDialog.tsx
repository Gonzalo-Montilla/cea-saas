import { type ReactNode, useId } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ModalBase } from './ModalBase';
import '../../styles/ui-kit.css';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'primary' | 'danger';
  isLoading?: boolean;
  children?: ReactNode;
}

export const ConfirmDialog = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  confirmVariant = 'primary',
  isLoading = false,
  children
}: ConfirmDialogProps) => {
  const confirmClass = confirmVariant === 'danger' ? 'btn-danger' : 'btn-primary';
  const messageId = useId();

  return (
    <ModalBase
      isOpen={isOpen}
      title={title}
      onClose={onCancel}
      closeDisabled={isLoading}
      role="alertdialog"
      describedBy={messageId}
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={isLoading}>
            {cancelText}
          </button>
          <button type="button" className={confirmClass} onClick={onConfirm} disabled={isLoading}>
            {isLoading ? 'Procesando...' : confirmText}
          </button>
        </>
      }
    >
      <div className="ui-confirm-content">
        <span className="ui-confirm-icon" aria-hidden="true">
          <AlertTriangle size={18} />
        </span>
        <p id={messageId}>{message}</p>
      </div>
      {children}
    </ModalBase>
  );
};
