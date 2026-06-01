import React from 'react';

interface ToastProps {
  toast: {
    show: boolean;
    message: string;
  };
}

const Toast: React.FC<ToastProps> = ({ toast }) => {
  if (!toast.show) return null;

  return (
    <div className="toast show">
      {toast.message}
    </div>
  );
};

export default Toast;