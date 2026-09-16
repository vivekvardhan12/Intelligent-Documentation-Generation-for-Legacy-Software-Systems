import React, { useEffect } from 'react';
import { RotateCcw, AlertTriangle, X, ArrowRight } from 'lucide-react';

interface ResetConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  currentTargetName: string;
  currentBudget: number;
  runCount: number;
}

export const ResetConfirmModal: React.FC<ResetConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  currentTargetName,
  currentBudget,
  runCount,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      id="reset-confirm-modal"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-modal-title"
    >
      <div
        className="bg-white rounded-xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-start justify-between bg-slate-50">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 id="reset-modal-title" className="text-base font-bold text-slate-900">
                Reset Benchmark Session?
              </h3>
              <p className="text-xs text-slate-500">
                Confirm session restoration to default baseline
              </p>
            </div>
          </div>
          <button
            id="close-reset-modal-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-200/60 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs sm:text-sm text-slate-600">
          <p className="leading-relaxed">
            Are you sure you want to reset the current experimental workspace? This action will restore all benchmark configuration parameters and clear trial history.
          </p>

          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-2 text-xs font-mono">
            <div className="flex items-center justify-between text-slate-700 font-sans font-semibold border-b border-slate-200/80 pb-1.5">
              <span>Configuration State</span>
              <span>After Reset</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-sans">Token Budget:</span>
              <span className="flex items-center space-x-1 text-slate-800">
                <span>{currentBudget}t</span>
                <ArrowRight className="w-3 h-3 text-slate-400" />
                <span className="font-bold text-indigo-700">750t</span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-sans">Target Function:</span>
              <span className="text-slate-800 font-medium truncate max-w-[180px]">
                TokenBucket.consume
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-sans">Session Trials:</span>
              <span className="flex items-center space-x-1 text-slate-800">
                <span>{runCount} runs</span>
                <ArrowRight className="w-3 h-3 text-slate-400" />
                <span className="font-bold text-slate-900">1 baseline</span>
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end space-x-2.5">
          <button
            id="cancel-reset-btn"
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs transition-colors"
          >
            Cancel
          </button>
          <button
            id="confirm-reset-btn"
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-rose-600 text-xs font-bold text-white hover:bg-rose-700 shadow-xs transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Session</span>
          </button>
        </div>
      </div>
    </div>
  );
};
