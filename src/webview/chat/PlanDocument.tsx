import { createContext, useContext, useId, useState } from 'react';
import { ArrowLeft, ArrowUpRight, ChevronDown, FileText } from 'lucide-react';
import type { ConfigControl, PermissionBlock, PlanDocumentBlock, SessionControls } from '@shared/transcript';
import type { MsgKey } from '@shared/i18n';
import { groupModels, variantLabel } from '@shared/models';
import { Button, Chip, IconButton } from '../ui/Button';
import { Card } from '../ui/Card';
import { cn } from '../ui/cn';
import { t } from '../i18n';
import { MenuFooter, MenuHeader, MenuList, Popover } from '../ui/Popover';
import { Row, RowTarget } from '../ui/Row';
import { ModelOptions } from './Composer';
import { Prose } from './Prose';

type ExecutionModel = { configId: string; value: string };
export const PlanDocumentContext = createContext<{
  controls: SessionControls;
  hidden?: Record<string, string[]>;
  running: boolean;
  ready: boolean;
  permissions?: PermissionBlock[];
  build?: (planId: string, model?: ExecutionModel, optionId?: string) => void;
  open?: (planId: string) => void;
}>({ controls: { modes: [], options: [] }, running: false, ready: false });

// Saved plans stay outside the process fold. Model selection is local until Build,
// so choosing an executor never changes the model generating the current plan.
export function PlanDocument({ block, permission: suppliedPermission, onChoose }: {
  block: PlanDocumentBlock;
  permission?: PermissionBlock;
  onChoose: (blockId: string, optionId: string) => void;
}) {
  const ctx = useContext(PlanDocumentContext);
  const permission = suppliedPermission ?? ctx.permissions?.find(p => p.planId === block.id);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<ExecutionModel>();
  const previewId = useId();
  const model = ctx.controls.options.find(c => c.category === 'model');
  const choice = model && selected?.configId === model.id && model.options.some(o => o.id === selected.value)
    ? selected : model?.value ? { configId: model.id, value: model.value } : undefined;
  const family = model && groupModels(model.options).find(f => f.variants.some(v => v.id === choice?.value));
  const variant = family?.variants.find(v => v.id === choice?.value);
  const params = family && variant && (family.efforts.length > 1 || variant.effort || variant.fast || variant.long)
    ? variantLabel(variant, family) : undefined;
  // Keep the selected executor visible after the menu closes, including source
  // and parameters that distinguish otherwise identical model names.
  const executor = family && variant
    ? [family.name, family.source, params].filter(Boolean).join(' · ')
    : model?.options.find(o => o.id === choice?.value)?.name;
  const busy = !ctx.ready || (ctx.running && !permission) || block.status === 'draft' || block.status === 'executing';
  const primary = permission?.options.find(o => o.kind === 'allow_once');
  // Kimi's reject-and-exit is distinct from revising in Plan mode; keep it in the
  // additional approvals menu instead of relabeling it as a revision.
  const revise = permission?.options.find(o => o.kind === 'reject_once' && !/exit/i.test(o.id) && !/退出/.test(o.label));
  const extra = permission?.options.filter(o => o.id !== primary?.id && o.id !== revise?.id) ?? [];
  const summary = block.markdown.replace(/^#\s+[^\n]+\n*/, '').split(/\n\s*\n/)[0];
  const filename = block.path?.split(/[\\/]/).pop() || 'plan.md';
  const labels: Record<PlanDocumentBlock['status'], MsgKey> = {
    draft: 'plan.status.draft', ready: 'plan.status.ready', approved: 'plan.status.approved',
    rejected: 'plan.status.rejected', executing: 'plan.status.executing',
  };
  const choose = (optionId: string) => {
    const option = permission?.options.find(o => o.id === optionId);
    if (option?.kind.startsWith('allow')) ctx.build?.(block.id, choice, optionId);
    else if (permission) onChoose(permission.id, optionId);
  };
  return (
    <Card className="flex min-w-0 flex-col gap-pad p-pad" data-plan-document={block.id}>
      <Row lead={<FileText className="size-icon" strokeWidth={1.5} />} dense trailing={<>
        <span>{permission ? t('plan.pendingApproval') : t(labels[block.status])}</span>
        <IconButton title={t('plan.openFile')} aria-label={t('plan.openFile')} onClick={() => ctx.open?.(block.id)} disabled={!ctx.open}>
          <ArrowUpRight strokeWidth={1.5} />
        </IconButton>
      </>}>
        <RowTarget className="text-3 text-fg-3"><span title={block.path}>{filename}</span></RowTarget>
      </Row>
      <div className="flex min-w-0 flex-col gap-gap">
        <button type="button" aria-expanded={expanded} aria-controls={previewId}
          title={expanded ? t('plan.collapse') : t('plan.expand')} onClick={() => setExpanded(v => !v)}
          className="group flex w-full items-center gap-gap rounded-sm text-left text-1 font-semibold text-fg-strong outline-none focus-visible:ring-1 focus-visible:ring-line-strong">
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{block.title}</span>
          <ChevronDown className={cn('size-icon shrink-0 text-fg-3 group-hover:text-fg-1', expanded && 'rotate-180')} strokeWidth={1.5} />
        </button>
        <div id={previewId}>
          {expanded
            ? <Prose block={{ type: 'text', markdown: block.markdown }} />
            : summary && <p className="m-0 line-clamp-2 whitespace-pre-wrap text-2 text-fg-2 [overflow-wrap:anywhere]">{summary}</p>}
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-gap">
        {revise ? <Button variant="secondary" disabled={!ctx.ready} title={revise.label} onClick={() => choose(revise.id)}
          className="shrink-0">{t('plan.revise')}</Button> : <span />}
        <div className="ml-auto flex min-w-0 items-center gap-gap">
          {(model || extra.length > 0) && <Popover side="top" align="end" width="md" role="menu"
            content={close => <BuildMenu model={model && { ...model, value: choice?.value ?? model.value }}
              hidden={model && ctx.hidden?.[model.id]} extra={extra} ready={ctx.ready} canBuild={!busy && !!ctx.build && !!block.markdown}
              onSelect={value => model && setSelected({ configId: model.id, value })} onChoose={choose} close={close} />}>
            {({ open, toggle, ref }) => <Chip ref={ref} data-open={open || undefined} aria-expanded={open}
              aria-haspopup="menu" aria-label={t('plan.approvalsAria')} title={executor ?? t('plan.moreApprovals')} onClick={toggle}
              meta={[family?.source, params].filter(Boolean).join(' · ') || undefined} data-plan-executor>
              {family?.name ?? executor ?? t('plan.approvals')}
            </Chip>}
          </Popover>}
          <Button variant="primary" className="shrink-0"
            disabled={busy || !ctx.build || !block.markdown}
            onClick={() => ctx.build?.(block.id, choice, primary?.id)}>Build</Button>
        </div>
      </div>
    </Card>
  );
}

// Additional permission choices retain their original ACP IDs and labels. They
// live on a separate menu page so the model list remains a homogeneous list.
function BuildMenu({ model, hidden, extra, ready, canBuild, onSelect, onChoose, close }: {
  model?: ConfigControl;
  hidden?: string[];
  extra: PermissionBlock['options'];
  ready: boolean;
  canBuild: boolean;
  onSelect: (value: string) => void;
  onChoose: (optionId: string) => void;
  close: () => void;
}) {
  const [approvals, setApprovals] = useState(!model);
  if (approvals) return <MenuList header={<MenuHeader
    lead={model ? { label: t('plan.backToExecutor'), icon: <ArrowLeft />, onClick: () => setApprovals(false) } : undefined}>{t('plan.moreApprovals')}</MenuHeader>}
    items={extra.map(o => ({ id: o.id, label: o.label, disabled: o.kind.startsWith('allow') ? !canBuild : !ready }))}
    onSelect={id => { onChoose(id); close(); }} />;
  return <>
    <MenuHeader>{t('plan.executor')}</MenuHeader>
    {model && <ModelOptions control={model} hidden={hidden} onSelect={onSelect} close={close} />}
    {extra.length > 0 && <MenuFooter onClick={() => setApprovals(true)}>{t('plan.moreApprovals')}</MenuFooter>}
  </>;
}
