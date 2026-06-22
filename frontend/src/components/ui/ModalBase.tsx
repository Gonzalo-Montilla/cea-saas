import { type ReactNode, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import '../../styles/ui-kit.css';

type ModalSize = 'sm' | 'md' | 'lg';

interface ModalBaseProps {
  isOpen: boolean;
  title?: ReactNode;
  onClose?: () => void;
  closeDisabled?: boolean;
  size?: ModalSize;
  zIndex?: number;
  children: ReactNode;
  footer?: ReactNode;
  labelledBy?: string;
  describedBy?: string;
  role?: 'dialog' | 'alertdialog';
}

export const ModalBase = ({
  isOpen,
  title,
  onClose,
  closeDisabled = false,
  size = 'md',
  zIndex = 3000,
  children,
  footer,
  labelledBy,
  describedBy,
  role = 'dialog'
}: ModalBaseProps) => {
  const internalId = useId();
  const titleId = labelledBy || `ui-modal-title-${internalId}`;
  const modalRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    closeDisabledRef.current = closeDisabled;
  }, [closeDisabled]);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedElementRef.current = document.activeElement as HTMLElement | null;

    const focusableElements = modalRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );

    const firstFormField = modalRef.current?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
    );

    if (firstFormField) {
      firstFormField.focus();
    } else if (focusableElements && focusableElements.length > 0) {
      focusableElements[0].focus();
    } else {
      modalRef.current?.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!modalRef.current) return;

      if (event.key === 'Escape' && onCloseRef.current && !closeDisabledRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const currentFocusableElements = modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

      if (!currentFocusableElements.length) {
        event.preventDefault();
        modalRef.current.focus();
        return;
      }

      const first = currentFocusableElements[0];
      const last = currentFocusableElements[currentFocusableElements.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;

      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedElementRef.current?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="ui-modal-overlay"
      style={{ zIndex }}
      onMouseDown={() => (!closeDisabled ? onClose?.() : undefined)}
    >
      <div
        ref={modalRef}
        className={`ui-modal ui-modal-${size}`}
        role={role}
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={describedBy}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {title && (
          <div className="ui-modal-header">
            <h3 id={titleId}>{title}</h3>
            {onClose && (
              <button
                type="button"
                className="ui-modal-close"
                onClick={onClose}
                disabled={closeDisabled}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="ui-modal-body">{children}</div>
        {footer && <div className="ui-modal-footer">{footer}</div>}
      </div>
    </div>
  );
};
