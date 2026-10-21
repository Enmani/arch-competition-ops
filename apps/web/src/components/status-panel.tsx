import type { ReactNode } from "react";

type StatusPanelProps = {
  actions?: ReactNode;
  body: string;
  children?: ReactNode;
  eyebrow: string;
  /** "alert" announces the panel immediately (error boundary); others are plain content. */
  role?: "alert";
  title: string;
};

/** Shared layout for the 404, error and 403 states. Presentational: no copy of its own. */
export const StatusPanel = ({ actions, body, children, eyebrow, role, title }: StatusPanelProps) => (
  <main className="status-page">
    <section className="status-panel" role={role}>
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{body}</p>
      {children}
      {actions ? <div className="status-actions">{actions}</div> : null}
    </section>
  </main>
);
