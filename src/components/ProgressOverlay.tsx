import React from 'react';

interface ProgressOverlayProps {
  progress: {
    show: boolean;
    label: string;
    percent: number;
  };
}

const ProgressOverlay: React.FC<ProgressOverlayProps> = ({ progress }) => {
  if (!progress.show) return null;

  return (
    <div className="progress-overlay show">
      <div className="label">{progress.label}</div>
      <div className="bar">
        <div style={{ width: `${progress.percent}%` }}></div>
      </div>
    </div>
  );
};

export default ProgressOverlay;