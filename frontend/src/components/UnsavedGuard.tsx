import { useContext, useEffect, useRef } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom';

type Props = { shouldBlock: () => boolean };

function Dialog({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const discardRef = useRef<HTMLButtonElement>(null);
  useEffect(() => keepRef.current?.focus(), []);
  return (
    <div
      className="rr-modal-backdrop"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onKeep();
        } else if (e.key === 'Tab') {
          // keep focus inside the dialog: two buttons, cycle between them
          e.preventDefault();
          (document.activeElement === keepRef.current ? discardRef : keepRef).current?.focus();
        }
      }}>
      <div className="rr-modal" role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-body">
        <h2 id="discard-title">Discard unsaved changes?</h2>
        <p id="discard-body">You have changes in Settings that have not been saved. If you leave now, they will be lost.</p>
        <div className="rr-actions">
          <button ref={keepRef} type="button" className="rr-btn primary" onClick={onKeep}>Keep editing</button>
          <button ref={discardRef} type="button" className="rr-btn danger" onClick={onDiscard}>Discard changes</button>
        </div>
      </div>
    </div>
  );
}

function RouterGuard({ shouldBlock }: Props) {
  const blocker = useBlocker(() => shouldBlock());
  if (blocker.state !== 'blocked') return null;
  return <Dialog onKeep={() => blocker.reset()} onDiscard={() => blocker.proceed()} />;
}

/**
 * Asks "Discard unsaved changes?" in an in-app dialog (not a browser alert) when the user tries to leave the page by
 * following a link or using the Back button. Needs a data router; without one (e.g. in a plain MemoryRouter) it does
 * nothing. Closing or reloading the tab can only be guarded by the browser's own prompt, which the page adds separately.
 */
export function UnsavedGuard(props: Props) {
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  return dataRouter ? <RouterGuard {...props} /> : null;
}
