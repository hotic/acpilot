import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Draft, SessionControls, Turn, Usage } from '@shared/transcript';
import type { FileHit } from '@shared/protocol';
import type { HiddenMap } from '@shared/settings';
import { composerControls } from '@shared/composerControls';
import { useAppearance } from '../appearance';
import { t } from '../i18n';
import { cn } from '../ui/cn';
import { Chip, IconButton } from '../ui/Button';
import { Menu } from '../ui/Menu';
import { WorkingBeam } from '../effects/WorkingBeam';
import { SendButton } from '../effects/SendButton';
import { DraftChips } from './Attachments';
import { collectDrafts, hasPayload } from './drafts';
import { MentionList, mentionAt, useMentionHits } from './Mention';
import { modeIcon } from './modeIcons';
import { ModelControl, OptionControl, ReasoningControl } from './ModelPicker';
import { ContextRing } from './ContextUsage';
import { useComposerDraft } from './useComposerDraft';

export interface ComposerProps {
  running: boolean;
  // Entire composer disabled while the session isn't ready (connecting / login required / read-only)
  disabled?: boolean;
  theme: 'dark' | 'light';
  controls: SessionControls;
  turns: Turn[];
  // Option families hidden for the current agent (settings page): configOption id → family names
  hidden?: HiddenMap[string];
  usage?: Usage;
  canCompact?: boolean;
  // Workspace root: dropped and mentioned files are labeled relative to it
  cwd: string;
  onSend: (text: string, attachments: Draft[]) => void | Promise<void>;
  // Inline history editors keep their draft until the host accepts the resend.
  // Outside-dismiss editors omit cancel and attachment-removal buttons.
  edit?: { text: string; attachments?: ReactNode; hasAttachments: boolean; onCancel: () => void; dismissOnOutside?: boolean };
  // Where the unsent draft (text + attachments) is parked while another session is shown; the session id. Absent: nothing is kept across remounts
  draftKey?: string;
  onSearchFiles: (query: string) => Promise<FileHit[]>;
  // Something couldn't be attached; the shell shows it as a toast
  onNotice: (text: string) => void;
  onStop: () => void;
  onSetMode: (id: string) => void;
  onSetConfig: (configId: string, value: string) => void;
  onCompact: () => void;
}

// Composer has three layers: attachment chips (when any), the input area, and a toolbar row below.
// One layout for all ACP agents: mode on the left; context, model with reasoning, and send on the right.
// Attachments come from pasting / dropping (images, OS files, Explorer items) or from an @ mention that searches the workspace
export function Composer(p: ComposerProps) {
  const { composer } = useAppearance();
  const { text, setText, drafts, setDrafts } = useComposerDraft(p.draftKey, p.edit?.text);
  const flush = !p.edit && composer === 'flush';
  // The beam lights up while the composer is focused (focus-within semantics), not while it's working.
  // Overlays portal to the shell root, so opening a menu blurs the composer; "a menu is open" therefore also counts as focused
  const [focused, setFocused] = useState(false);
  const [openMenus, setOpenMenus] = useState(0);
  const onOpenChange = useCallback((open: boolean) => setOpenMenus(n => n + (open ? 1 : -1)), []);
  const beamActive = focused || openMenus > 0;
  const mode = p.controls.modes.find(m => m.id === p.controls.modeId);
  const dim = p.running || p.disabled;
  const { models, reasoning, other } = composerControls(p.controls.options);
  // Files are read asynchronously after a paste / drop; sending is held until every read has landed, so a message never leaves without its attachments
  const [reading, setReading] = useState(0);
  const [sending, setSending] = useState(false);
  const canSend = !p.disabled && !sending && reading === 0 && (text.trim().length > 0 || drafts.length > 0 || !!p.edit?.hasAttachments);
  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await p.onSend(text, drafts);
      setText('');
      setDrafts([]);
      setDismissed(undefined);
    } catch (e) {
      p.onNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  // Drop zone: the whole field lights up while something attachable hovers over it. Enter / leave are counted rather than trusting relatedTarget,
  // which is null for drags coming from outside the window
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const addFrom = async (dt: DataTransfer) => {
    setReading(n => n + 1);
    try {
      const { drafts: more, refused } = await collectDrafts(dt, p.cwd);
      if (more.length) setDrafts(d => [...d, ...more.filter(m => m.kind !== 'file' || !d.some(x => x.kind === 'file' && x.uri === m.uri))]);
      if (refused.length) p.onNotice(refused.join(t('common.listSep')));
    } catch (e) {
      p.onNotice(t('composer.attachFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setReading(n => n - 1);
    }
  };
  const takes = (dt: DataTransfer | null) => !p.disabled && hasPayload(dt);
  const onDragEnter = (e: DragEvent) => { if (!takes(e.dataTransfer)) return; e.preventDefault(); dragDepth.current++; setDragging(true); };
  const onDragOver = (e: DragEvent) => { if (takes(e.dataTransfer)) e.preventDefault(); };
  const onDragLeave = (e: DragEvent) => { if (!takes(e.dataTransfer)) return; if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } };
  // Plain text drags are left to the textarea's native handling; only attachable payloads are taken over
  const onDrop = (e: DragEvent) => {
    dragDepth.current = 0;
    setDragging(false);
    if (!takes(e.dataTransfer)) return;
    e.preventDefault();
    void addFrom(e.dataTransfer);
  };
  // Likewise plain text pastes fall through; only pastes carrying files are taken over
  const onPaste = (e: ClipboardEvent) => {
    if (!hasPayload(e.clipboardData) || !e.clipboardData.files.length) return;
    e.preventDefault();
    void addFrom(e.clipboardData);
  };

  // @ mention: the span under the caret drives the file list (only with a collapsed selection); Esc parks it for that @ until the caret leaves or the message is sent
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [collapsed, setCollapsed] = useState(true);
  const [dismissed, setDismissed] = useState<number>();
  const span = collapsed ? mentionAt(text, caret) : undefined;
  const mentionOpen = !!span && span.start !== dismissed && !p.disabled;
  const { hits, ready, active, setActive, move } = useMentionHits(mentionOpen ? span.query : undefined, p.onSearchFiles);
  const pick = (hit: FileHit) => {
    if (!span) return;
    const next = text.slice(0, span.start) + text.slice(caret);
    setText(next);
    setCaret(span.start);
    setDrafts(d => (d.some(x => x.kind === 'file' && x.uri === hit.uri) ? d : [...d, { kind: 'file', uri: hit.uri, name: hit.path }]));
    requestAnimationFrame(() => textarea.current?.setSelectionRange(span.start, span.start));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (mentionOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (e.key === 'Escape') { e.preventDefault(); setDismissed(span!.start); return; }
      // Enter / Tab pick the active hit; while the hits for this query are still on their way, Enter waits instead of sending a half-typed @ (Shift+Enter still breaks the line)
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        if (!ready) { e.preventDefault(); return; }
        if (hits[active]) { e.preventDefault(); pick(hits[active]!); return; }
      }
    }
    if (e.key === 'Escape' && p.edit && !sending) { e.preventDefault(); p.edit.onCancel(); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };
  const syncCaret = (el: HTMLTextAreaElement) => {
    setCaret(el.selectionStart);
    setCollapsed(el.selectionStart === el.selectionEnd);
    if (dismissed !== undefined && !mentionAt(el.value, el.selectionStart)) setDismissed(undefined);
  };

  const field = (
    <div
      ref={fieldRef}
      data-busy={dim || undefined}
      data-drag={dragging || undefined}
      data-focused={beamActive || undefined}
      className={cn('composer-field flex flex-col', flush ? 'rounded-none' : 'rounded-lg')}
      onFocus={() => setFocused(true)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {p.edit?.attachments}
      <DraftChips drafts={drafts} onRemove={p.edit?.dismissOnOutside ? undefined : i => setDrafts(d => d.filter((_, j) => j !== i))} />
      <textarea
        ref={textarea}
        rows={1}
        value={text}
        disabled={p.disabled || sending}
        autoFocus={!!p.edit}
        aria-label={p.edit ? t('history.edit') : t('composer.placeholder')}
        onChange={e => { setText(e.target.value); syncCaret(e.target); }}
        onKeyUp={e => syncCaret(e.currentTarget)}
        onClick={e => syncCaret(e.currentTarget)}
        onSelect={e => syncCaret(e.currentTarget)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={p.disabled ? t('composer.notReady') : p.running ? t('composer.placeholder.queue') : t('composer.placeholder')}
        className={cn(
          'min-w-0 resize-none bg-transparent px-3 pt-2.5 pb-1 text-1 outline-none transition-colors',
          'max-h-[calc(8*var(--text-1-lh))] placeholder:text-fg-3',
          // Queued / follow-up text while a turn runs stays at full strength; only an unready session dims the field
          p.disabled ? 'text-fg-3/60 placeholder:text-fg-3/60' : 'text-fg-strong',
        )}
      />
      {mentionOpen && <MentionList anchor={fieldRef} hits={hits} active={active} empty={span!.query.length > 0} onHover={setActive} onPick={pick} />}
      {/* The row is a container: below the sm tier (a 380 sidebar leaves ~324 here) the mode chip collapses to icon + caret so the option chips keep their room —
          the same move Cursor makes in a narrow sidebar; the editor panel is wide enough for the names */}
      <fieldset disabled={p.disabled || sending} className="@container flex min-w-0 items-center gap-1 px-2 pt-1 pb-2">
        <div className="flex shrink-0 items-center gap-1">
          {/* Mode is the one solid chip and never truncates; single-line rows with a glyph each, the description rides along as a tooltip */}
          {p.controls.modes.length > 0 && (
            <Menu
              side="top"
              width="sm"
              items={p.controls.modes.map(m => {
                const Icon = modeIcon(m);
                return { id: m.id, label: m.name, hint: m.description, icon: <Icon strokeWidth={1.75} />, checked: m.id === p.controls.modeId };
              })}
              onSelect={p.onSetMode}
              onOpenChange={onOpenChange}
            >
              {({ open, toggle, ref }) => {
                const Icon = mode ? modeIcon(mode) : undefined;
                return (
                  <Chip
                    ref={ref} variant="solid" className="ml-0.5 shrink-0" narrow="icon" data-open={open || undefined} onClick={toggle}
                    title={mode ? [mode.name, mode.description].filter(Boolean).join(' · ') : t('composer.mode')} icon={Icon && <Icon strokeWidth={1.75} />}
                  >
                    {mode?.name ?? t('composer.mode')}
                  </Chip>
                );
              }}
            </Menu>
          )}
        </div>
        <div className="min-w-0 flex-1" />
        {other.map(c => (
          <OptionControl key={c.id} end control={c} hidden={p.hidden?.[c.id]} onSelect={v => p.onSetConfig(c.id, v)} onOpenChange={onOpenChange} />
        ))}
        {p.usage && <ContextRing usage={p.usage} turns={p.turns} canCompact={!!p.canCompact && !dim} onCompact={p.onCompact} onOpenChange={onOpenChange} />}
        {models.map((c, i) => (
          <ModelControl key={c.id} control={c} hidden={p.hidden?.[c.id]} reasoning={i === 0 ? reasoning : undefined}
            onSetReasoning={p.onSetConfig} onSelect={v => p.onSetConfig(c.id, v)} onOpenChange={onOpenChange} />
        ))}
        {!models.length && reasoning.map(c => (
          <ReasoningControl key={c.id} control={c} onSelect={v => p.onSetConfig(c.id, v)} onOpenChange={onOpenChange} />
        ))}
        {p.edit && !p.edit.dismissOnOutside && <IconButton title={t('history.cancel')} aria-label={t('history.cancel')} onClick={p.edit.onCancel}><X /></IconButton>}
        <SendButton running={p.running} filled={canSend} theme={p.theme} onClick={p.running ? p.onStop : send} />
      </fieldset>
    </div>
  );

  return (
    <div className={cn(p.edit ? 'min-w-0' : flush ? 'pt-0' : 'px-page pb-page pt-2')}>
      <WorkingBeam active={beamActive} theme={p.theme}>{field}</WorkingBeam>
    </div>
  );
}
