"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

type OpportunityDrawerProps = {
  children: ReactNode;
  closeLabel: string;
  label: string;
};

/**
 * Side sheet over the list. A native modal dialog supplies the focus trap, Esc handling and the
 * inert background; the route (an intercepted /opportunities/[slug]) supplies back-button
 * behaviour and a shareable address, so closing is always `router.back()`.
 */
export const OpportunityDrawer = ({ children, closeLabel, label }: OpportunityDrawerProps) => {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previousOverflow;
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  const close = () => router.back();

  return (
    <dialog
      aria-label={label}
      className="detail-drawer"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
      ref={dialogRef}
    >
      <div className="detail-drawer-bar">
        <button aria-label={closeLabel} className="detail-drawer-close" onClick={close} title={closeLabel} type="button">
          <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 16 16" width="16">
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
      </div>
      <div className="detail-drawer-scroll">{children}</div>
    </dialog>
  );
};
