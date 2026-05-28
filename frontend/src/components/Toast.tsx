import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

type ToastType = 'info' | 'success' | 'error' | 'warning';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const TOAST_STYLES: Record<ToastType, { bg: string; border: string; icon: string }> = {
  info: { bg: 'rgba(74, 111, 165, 0.95)', border: 'rgba(74, 111, 165, 0.3)', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-4M12 8h.01' },
  success: { bg: 'rgba(45, 106, 90, 0.95)', border: 'rgba(45, 106, 90, 0.3)', icon: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3' },
  error: { bg: 'rgba(185, 28, 28, 0.95)', border: 'rgba(185, 28, 28, 0.3)', icon: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01' },
  warning: { bg: 'rgba(200, 121, 65, 0.95)', border: 'rgba(200, 121, 65, 0.3)', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v4M12 16h.01' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3800);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[99999] flex flex-col gap-2.5 pointer-events-none max-w-sm">
        {toasts.map(t => {
          const style = TOAST_STYLES[t.type];
          return (
            <div
              key={t.id}
              className="pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-xl text-[13px] font-medium text-white shadow-lg"
              style={{
                background: style.bg,
                backdropFilter: 'blur(8px)',
                border: `1px solid ${style.border}`,
                animation: 'msg-slide-up 250ms var(--ease-out)',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-80">
                <path d={style.icon} />
              </svg>
              <span className="leading-snug">{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
