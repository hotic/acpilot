import type { AgentInfo } from '@shared/transcript';
import { FOLLOW_UPS, type FollowUp, type SettingsView } from '@shared/settings';
import { LANGUAGES, type Language } from '@shared/i18n';
import { AgentMark } from '../chat/AgentMark';
import { t } from '../i18n';
import { Field, NumberField, Page, Section, Segmented, Select, Switch } from './controls';
import type { SettingsHandlers } from './SettingsShell';

// General: the shell's own knobs. Appearance axes are deliberately absent — they are design decisions, not user settings.
// No page title: the tab / top bar already says "General"
export function General({ settings, agents, on }: { settings: SettingsView; agents: AgentInfo[]; on: SettingsHandlers }) {
  const languages = LANGUAGES.map(l => ({ value: l, label: t(`settings.language.${l}` as const) }));
  const agentOptions = agents.map(a => ({ value: a.id, label: a.name, icon: <AgentMark id={a.id} name={a.name} />, disabled: a.available === false }));
  const followUps = FOLLOW_UPS.map(f => ({ value: f, label: t(`settings.followUp.${f}` as const) }));
  return (
    <Page>
      <Section>
        <Field label={t('settings.language')} desc={t('settings.language.desc')}>
          <Select<Language> options={languages} value={settings.language} onChange={v => on.setSetting('language', v)} label={t('settings.language')} />
        </Field>
        <Field label={t('settings.defaultAgent')} desc={t('settings.defaultAgent.desc')}>
          <Select options={agentOptions} value={settings.defaultAgent} onChange={v => on.setSetting('defaultAgent', v)} label={t('settings.defaultAgent')} />
        </Field>
        <Field label={t('settings.followUp')} desc={t('settings.followUp.desc')} stack>
          <Segmented<FollowUp> options={followUps} value={settings.followUp} onChange={v => on.setSetting('followUp', v)} label={t('settings.followUp')} />
        </Field>
      </Section>

      <Section title={t('settings.compaction.title')}>
        <Field label={t('settings.autoCompact')} desc={t('settings.autoCompact.desc')}>
          <Switch checked={settings.autoCompact} onChange={v => on.setSetting('autoCompact', v)} label={t('settings.autoCompact')} />
        </Field>
        <Field label={t('settings.compactAt')} desc={t('settings.compactAt.desc')}>
          <NumberField
            value={Math.round(settings.compactAtTokens / 1000)}
            min={10}
            step={10}
            unit={t('settings.compactAt.unit')}
            label={t('settings.compactAt')}
            onCommit={v => on.setSetting('compactAtTokens', v * 1000)}
          />
        </Field>
      </Section>
    </Page>
  );
}
