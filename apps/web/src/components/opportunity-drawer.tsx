"use client";

import { useEffect, useRef, type ReactNode } from "react";

type OpportunityDrawerProps = {
  children: ReactNode;
  closeLabel: string;
  label: string;
  onClose: () => void;
};

/**
 * Side sheet over the list. A native modal dialog supplies the focus trap, Esc handling and the
 * inert background; the owner decides what closing means (the list pops its history entry).
 */
export const OpportunityDrawer = ({ children, closeLabel, label, onClose }: OpportunityDrawerProps) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }
    // Hiding the page scrollbar would widen the layout and shift the list; the stable gutter
    // keeps its space, so the list stays exactly where it was.
    const root = document.documentElement;
    const previous = { gutter: root.style.scrollbarGutter, overflow: root.style.overflow };
    root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous.overflow;
      root.style.scrollbarGutter = previous.gutter;
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  return (
    <dialog
      aria-label={label}
      className="detail-drawer"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      ref={dialogRef}
    >
      <div className="detail-drawer-bar">
        <button aria-label={closeLabel} className="detail-drawer-close" onClick={onClose} title={closeLabel} type="button">
          <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 16 16" width="16">
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
      </div>
      <div className="detail-drawer-scroll">{children}</div>
    </dialog>
  );
};
