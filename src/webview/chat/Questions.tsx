import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, MessageCircleQuestion, Pencil } from 'lucide-react';
import type { Question, QuestionAnswer, QuestionAnswers, QuestionBlock } from '@shared/transcript';
import { useAppearance } from '../appearance';
import { t } from '../i18n';
import { Card } from '../ui/Card';
import { Button, IconButton } from '../ui/Button';
import { Collapse } from '../ui/Collapse';
import { Disclosure } from '../ui/Disclosure';
import { RowLabel } from '../ui/Row';
import { cn } from '../ui/cn';
import { useScrollFade } from '../ui/useScrollFade';

export type OnAnswer = (blockId: string, answers: QuestionAnswers, skip?: boolean) => void;

// What the user has done with one question so far: picked option ids, whether the free-text row is the pick, and its text
interface Pick {
  options: string[];
  other: boolean;
  text: string;
}

const EMPTY: Pick = { options: [], other: false, text: '' };
const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// The answer a pick amounts to: nothing until something is chosen or typed
function answerOf(q: Question, p: Pick): QuestionAnswer | undefined {
  const text = p.text.trim();
  if (q.kind === 'text') return text || undefined;
  if (q.kind === 'single') return p.other ? text || undefined : p.options[0];
  const list = [...p.options, ...(p.other && text ? [text] : [])];
  return list.length ? list : undefined;
}

// The question card, pinned above the composer while the agent waits (Cursor's layout): a header with the title, a "1 of N" pager and a
// collapse toggle; the questions in one scrolling list, each with lettered option rows and an "Other…" row when free text is allowed;
// Skip / Continue in the footer. Letters, digits, arrows, Enter and Esc work while the card has focus; picking a single-select answer moves on
export function Questions({ block, onAnswer }: { block: QuestionBlock; onAnswer: OnAnswer }) {
  const root = useRef<HTMLDivElement>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [active, setActive] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  // The "Other…" field only exists once its row is picked, so focusing it waits for that render
  const [otherFocus, setOtherFocus] = useState<number>();
  const fade = useScrollFade<HTMLDivElement>();
  const qs = block.questions;
  const total = qs.length;
  const answers = useMemo(() => {
    const out: QuestionAnswers = {};
    for (const q of qs) { const a = answerOf(q, picks[q.id] ?? EMPTY); if (a !== undefined) out[q.id] = a; }
    return out;
  }, [qs, picks]);
  const answered = Object.keys(answers).length;
  const canContinue = answered > 0 && qs.every(q => !q.required || answers[q.id] !== undefined);
  const skip = useCallback(() => onAnswer(block.id, answers, true), [onAnswer, block.id, answers]);
  const submit = useCallback(() => { if (canContinue) onAnswer(block.id, answers); }, [canContinue, onAnswer, block.id, answers]);
  const update = (id: string, fn: (p: Pick) => Pick) => setPicks(ps => ({ ...ps, [id]: fn(ps[id] ?? EMPTY) }));
  // The card takes focus when it appears: the agent is waiting on these keys
  useEffect(() => { root.current?.focus({ preventScroll: true }); }, []);
  const go = useCallback((i: number) => {
    const next = Math.max(0, Math.min(total - 1, i));
    setActive(next);
    root.current?.querySelector<HTMLElement>(`[data-question="${next}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [total]);
  useEffect(() => {
    if (otherFocus === undefined) return;
    root.current?.querySelector<HTMLInputElement>(`[data-question="${otherFocus}"] input`)?.focus();
    setOtherFocus(undefined);
  }, [otherFocus]);
  // Choosing an option: a single-select pick moves to the next question, a multi-select toggles in place
  const choose = (i: number, q: Question, optionId: string) => {
    if (q.kind === 'multiple') update(q.id, p => ({ ...p, options: p.options.includes(optionId) ? p.options.filter(o => o !== optionId) : [...p.options, optionId] }));
    else {
      update(q.id, p => ({ ...p, other: false, options: [optionId] }));
      if (i >= total - 1) { setActive(i); return; }
      go(i + 1);
      // Landing on a free-text question puts the caret in its field right away
      if (qs[i + 1]?.kind === 'text') setOtherFocus(i + 1);
    }
  };
  const chooseOther = (i: number, q: Question) => {
    update(q.id, p => ({ ...p, other: q.kind === 'multiple' ? !p.other : true, ...(q.kind === 'single' ? { options: [] } : {}) }));
    setActive(i);
    setOtherFocus(i);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const typing = (e.target as HTMLElement).tagName === 'INPUT';
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      // Enter in a text field confirms it and moves on; on the last question it continues
      if (typing && active < total - 1) { go(active + 1); root.current?.focus({ preventScroll: true }); return; }
      submit();
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); if (typing) root.current?.focus({ preventScroll: true }); else skip(); return; }
    if (typing) return;
    if (e.key === 'ArrowUp' || e.key === '[') { e.preventDefault(); go(active - 1); return; }
    if (e.key === 'ArrowDown' || e.key === ']') { e.preventDefault(); go(active + 1); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const q = qs[active];
    if (!q || q.kind === 'text') return;
    const key = e.key.length === 1 ? e.key.toUpperCase() : '';
    const index = /^[1-9]$/.test(key) ? Number(key) - 1 : KEYS.indexOf(key);
    if (index < 0) return;
    if (index < q.options.length) { e.preventDefault(); choose(active, q, q.options[index]!.id); }
    else if (index === q.options.length && q.other) { e.preventDefault(); chooseOther(active, q); }
  };
  const label = t('question.of', { n: active + 1, total });
  return (
    <div className="px-page pt-2">
      <Card ref={root} tabIndex={-1} role="form" aria-label={t('question.title')} onKeyDown={onKeyDown} className="question-card flex flex-col overflow-hidden">
        <div className="flex h-ctl items-center gap-gap px-pad pt-gap">
          <MessageCircleQuestion className="size-icon shrink-0 text-fg-3" strokeWidth={1.75} />
          <span className="min-w-0 truncate text-2 font-medium text-fg-1">{t('question.title')}</span>
          <span className="flex-1" />
          {total > 1 && (
            <span className="flex items-center gap-0.5 text-3 text-fg-3 tabular-nums">
              <IconButton size="sm" aria-label={t('question.prev')} title={t('question.prev')} disabled={active === 0} onClick={() => go(active - 1)} className="disabled:opacity-40"><ChevronLeft strokeWidth={1.75} /></IconButton>
              <span className="px-0.5">{label}</span>
              <IconButton size="sm" aria-label={t('question.next')} title={t('question.next')} disabled={active === total - 1} onClick={() => go(active + 1)} className="disabled:opacity-40"><ChevronRight strokeWidth={1.75} /></IconButton>
            </span>
          )}
          <IconButton size="sm" aria-expanded={!collapsed} aria-label={collapsed ? t('question.expand') : t('question.collapse')} title={collapsed ? t('question.expand') : t('question.collapse')} onClick={() => setCollapsed(c => !c)}>
            <ChevronDown className={cn('transition-transform duration-(--dur-open)', collapsed && 'rotate-180')} strokeWidth={1.75} />
          </IconButton>
        </div>
        <Collapse open={!collapsed}>
          <div ref={fade} className="scroll-fade scroll-thin flex max-h-question-body flex-col gap-gap overflow-y-auto px-pad pt-gap pb-1">
            {block.message && <p className="m-0 text-2 text-fg-2 [overflow-wrap:anywhere]">{block.message}</p>}
            {qs.map((q, i) => (
              <QuestionItem
                key={q.id} index={i} question={q} pick={picks[q.id] ?? EMPTY} active={i === active}
                onActivate={() => setActive(i)}
                onChoose={id => choose(i, q, id)}
                onOther={() => chooseOther(i, q)}
                onText={text => update(q.id, p => ({ ...p, text, ...(q.kind === 'single' ? { other: true, options: [] } : q.kind === 'multiple' ? { other: true } : {}) }))}
              />
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 px-pad py-gap">
            <Button variant="secondary" kbd="Esc" onClick={skip}>{t('question.skip')}</Button>
            <Button variant="primary" kbd="⏎" disabled={!canContinue} className="disabled:opacity-50" onClick={submit}>{t('question.continue')}</Button>
          </div>
        </Collapse>
      </Card>
    </div>
  );
}

interface ItemProps {
  index: number;
  question: Question;
  pick: Pick;
  active: boolean;
  onActivate: () => void;
  onChoose: (optionId: string) => void;
  onOther: () => void;
  onText: (text: string) => void;
}

// One question: number + text, the lettered options, an "Other…" row that becomes a field, or just the field for a free-text question
function QuestionItem({ index, question: q, pick, active, onActivate, onChoose, onOther, onText }: ItemProps) {
  const groupRole = q.kind === 'multiple' ? 'group' : q.kind === 'single' ? 'radiogroup' : undefined;
  const placeholder = q.kind === 'text' ? t(q.numeric ? 'question.numberPlaceholder' : 'question.textPlaceholder') : t('question.otherPlaceholder');
  const field = (
    <input
      type="text"
      value={pick.text}
      inputMode={q.numeric ? 'decimal' : undefined}
      placeholder={placeholder}
      aria-label={q.text}
      onFocus={onActivate}
      onChange={e => onText(e.target.value)}
      className="min-w-0 flex-1 bg-transparent text-1 text-fg-strong outline-none placeholder:text-fg-3"
    />
  );
  return (
    <section data-question={index} data-active={active || undefined} className="flex min-w-0 flex-col" onPointerDown={onActivate}>
      <div className="flex min-h-row items-baseline gap-2 text-1 font-semibold text-fg-strong">
        <span className="shrink-0 tabular-nums text-fg-3">{index + 1}.</span>
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {q.title && <span className="text-fg-3">{q.title} · </span>}
          {q.text}
          {q.kind === 'multiple' && <span className="ml-2 text-3 font-normal text-fg-3">{t('question.multiple')}</span>}
        </span>
      </div>
      <div role={groupRole} aria-label={q.text} className="flex flex-col">
        {q.options.map((o, i) => {
          const selected = pick.options.includes(o.id);
          return (
            <OptionRow key={o.id} keyLabel={KEYS[i] ?? String(i + 1)} selected={selected} role={q.kind === 'multiple' ? 'checkbox' : 'radio'} onClick={() => onChoose(o.id)}>
              <span className={cn('min-w-0 [overflow-wrap:anywhere]', selected ? 'text-fg-strong' : 'text-fg-1')}>{o.label}</span>
              {o.description && <span className="min-w-0 text-3 text-fg-3 [overflow-wrap:anywhere]">{o.description}</span>}
            </OptionRow>
          );
        })}
        {q.kind !== 'text' && q.other && (
          <OptionRow keyLabel={KEYS[q.options.length] ?? ''} selected={pick.other} role={q.kind === 'multiple' ? 'checkbox' : 'radio'} onClick={onOther} field>
            {pick.other ? field : <span className="text-fg-3">{t('question.other')}</span>}
          </OptionRow>
        )}
        {q.kind === 'text' && (
          <div className="flex min-h-row items-center gap-gap rounded-md px-1.5">
            <span className="flex size-lead shrink-0 items-center justify-center text-fg-3"><Pencil className="size-icon" strokeWidth={1.5} /></span>
            {field}
          </div>
        )}
      </div>
    </section>
  );
}

// An option row: the key square (a kbd until picked, then the inverted fill), label and faint description; the whole row is the target.
// A row hosting the free-text field is a div so the field keeps its own focus
function OptionRow({ keyLabel, selected, role, onClick, field, children }: { keyLabel: string; selected: boolean; role: 'radio' | 'checkbox'; onClick: () => void; field?: boolean; children: ReactNode }) {
  const Tag = field ? 'div' : 'button';
  return (
    <Tag
      {...(field ? {} : { type: 'button' as const })}
      role={role}
      aria-checked={selected}
      onClick={field ? (e => { if ((e.target as HTMLElement).tagName !== 'INPUT') onClick(); }) : onClick}
      className={cn(
        'flex min-h-row w-full cursor-pointer items-center gap-gap rounded-md px-1.5 text-left text-1 transition-colors hover:bg-hover focus-visible:bg-hover',
        selected && 'bg-active',
      )}
    >
      <kbd className={cn('flex size-lead shrink-0 items-center justify-center !p-0 font-sans text-3 font-medium', selected && '!border-btn-1 !bg-btn-1 !text-btn-1-fg')}>{keyLabel}</kbd>
      <span className="flex min-w-0 flex-1 flex-col py-0.5">{children}</span>
    </Tag>
  );
}

// The record a resolved card leaves in the message: one row, expandable to the questions and what was picked
export function QuestionRecord({ block }: { block: QuestionBlock }) {
  const { toolLine } = useAppearance();
  const answers = block.answers ?? {};
  const n = Object.keys(answers).length;
  const label = block.outcome === 'answered' ? (n === 1 ? t('question.answeredOne') : t('question.answered', { n }))
    : block.outcome === 'skipped' ? t('question.skipped') : t('question.cancelled');
  return (
    <Disclosure
      lead={toolLine === 'text' ? undefined : <MessageCircleQuestion className="size-icon" strokeWidth={1.5} />}
      defaultOpen={block.outcome === 'answered'}
      body={
        <dl className="m-0 flex flex-col gap-1.5 text-2">
          {block.questions.map(q => {
            const a = answers[q.id];
            const names = a === undefined ? [] : (Array.isArray(a) ? a : [a]).map(v => q.options.find(o => o.id === v)?.label ?? v);
            return (
              <div key={q.id} className="flex min-w-0 flex-col">
                <dt className="text-fg-3 [overflow-wrap:anywhere]">{q.text}</dt>
                <dd className={cn('m-0 [overflow-wrap:anywhere]', names.length ? 'text-fg-1' : 'text-fg-3')}>{names.length ? names.join(', ') : t('question.noAnswer')}</dd>
              </div>
            );
          })}
        </dl>
      }
    >
      <RowLabel>{label}</RowLabel>
    </Disclosure>
  );
}
