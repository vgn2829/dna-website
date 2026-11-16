import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Bell, ChevronDown, Inbox, LogOut, Settings, UserPen, UserRound } from 'lucide-react';
import { CreatorAvatar } from './creators/CreatorParts';
import { useMyProfile } from '../lib/myProfile';

// ─────────────────────────────────────────────────────────────────────────
// Account menu (V1.1) — the signed-in student's avatar + name in the top-right
// of the site navbar, opening a keyboard-accessible menu. This is where
// "My profile" lives now; the workspace sidebar no longer carries it.
//
// Every entry reuses an existing destination or action:
//   My Profile / Edit Profile → /profile (the one profile page; no duplicate)
//   Account Settings          → the existing change-email modal
//   Notifications             → opens the navbar's existing notification panel
//   Invitations               → /showcase/manage, where project/credit invitations land
//   Sign out                  → the existing logout
// There is no direct-messaging feature in DNA, so there is deliberately no
// "Messages" entry that would lead nowhere.
// ─────────────────────────────────────────────────────────────────────────

export const OPEN_NOTIFICATIONS_EVENT = 'dna:open-notifications';

interface Props {
  roll: string;
  sessionName: string | null;
  onChangeEmail: () => void;
  onLogout: () => void;
  /** Hide the name next to the avatar (compact layouts). */
  compact?: boolean;
}

export function AccountMenu({ roll, sessionName, onChangeEmail, onLogout, compact }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const profile = useMyProfile(roll);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const name = profile.displayName ?? (sessionName?.trim() || roll);
  const firstName = name.split(' ')[0];

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Close on route change, outside pointer, and Escape.
  useEffect(() => { setOpen(false); }, [location.pathname, location.hash]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  // Focus the first item when the menu opens.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const items = (): HTMLElement[] => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };
  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); }
  };

  const run = (fn: () => void) => () => { setOpen(false); fn(); };
  const go = (to: string) => run(() => navigate(to));

  return (
    <div ref={rootRef} style={{ position: 'relative' }} data-testid="account-menu">
      <button
        ref={triggerRef}
        type="button"
        className="acct-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${name}`}
        onClick={() => setOpen(o => !o)}
        onKeyDown={onTriggerKey}
      >
        <CreatorAvatar name={name} src={profile.avatarUrl} size={26} />
        {!compact && <span className="acct-name">{firstName}</span>}
        <ChevronDown size={13} aria-hidden="true" style={{ opacity: 0.6, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <div id={menuId} ref={menuRef} role="menu" aria-label="Account" className="acct-menu" onKeyDown={onMenuKey}>
          <div className="acct-head">
            <CreatorAvatar name={name} src={profile.avatarUrl} size={36} />
            <div style={{ minWidth: 0 }}>
              <p className="acct-head-name">{name}</p>
              <p className="acct-head-sub">{profile.handle ? `@${profile.handle}` : roll}</p>
            </div>
          </div>
          <div role="separator" className="acct-sep" />
          <button role="menuitem" type="button" className="acct-item" onClick={go('/profile')}><UserRound size={15} aria-hidden="true" /> My Profile</button>
          <button role="menuitem" type="button" className="acct-item" onClick={go('/profile#edit-profile')}><UserPen size={15} aria-hidden="true" /> Edit Profile</button>
          <button role="menuitem" type="button" className="acct-item" onClick={run(onChangeEmail)}><Settings size={15} aria-hidden="true" /> Account Settings</button>
          <button role="menuitem" type="button" className="acct-item" onClick={run(() => window.dispatchEvent(new Event(OPEN_NOTIFICATIONS_EVENT)))}><Bell size={15} aria-hidden="true" /> Notifications</button>
          <button role="menuitem" type="button" className="acct-item" onClick={go('/showcase/manage')}><Inbox size={15} aria-hidden="true" /> Invitations</button>
          <div role="separator" className="acct-sep" />
          <button role="menuitem" type="button" className="acct-item" onClick={run(onLogout)}><LogOut size={15} aria-hidden="true" /> Sign out</button>
        </div>
      )}
    </div>
  );
}
