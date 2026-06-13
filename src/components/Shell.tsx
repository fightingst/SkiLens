import type { ReactNode } from 'react';

export function ScanNotice({ notice }: { notice: { type: 'info' | 'success' | 'error'; title: string; message?: string } }) {
  return (
    <div className={`scan-notice scan-notice--${notice.type}`} role="status" aria-live="polite">
      <div className="scan-notice__title">{notice.title}</div>
      {notice.message && <div className="scan-notice__message">{notice.message}</div>}
    </div>
  );
}

export function MacWindow({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="mac-window">
      <MacSidebar>{sidebar}</MacSidebar>
      <div className="mac-window__main">{children}</div>
    </div>
  );
}

function MacSidebar({ children }: { children: ReactNode }) {
  return (
    <aside className="mac-sidebar">
      <div className="mac-sidebar__content" />
      <div className="mac-sidebar__body">
        <div className="mac-sidebar__chrome" data-tauri-drag-region>
          <div className="mac-sidebar__drag-region" data-tauri-drag-region />
        </div>
        {children}
      </div>
    </aside>
  );
}

export function MacSidebarHeader({ title }: { title: string }) {
  return <div className="mac-sidebar__header">{title}</div>;
}
