import type { JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

/**
 * Settings-form scaffold (P-056). Zod is the single validation source; the
 * resolver feeds it into react-hook-form so the full Settings page (P-225:
 * AI provider/model, appearance, licenses, sandbox, network) can grow each
 * section from this exact pattern. The schema has no transforms, so its
 * input and output types are identical and `useForm<SettingsFormValues>`
 * unifies with the resolver's `Resolver<Values, any, Values>`.
 */
export const settingsSchema = z.object({
  provider: z.enum(['openrouter', 'anthropic', 'ollama']),
  model: z.string().min(1, 'Model is required'),
  theme: z.enum(['light', 'dark', 'auto']),
  tokenBudget: z.number().int().min(1, 'Token budget must be at least 1').max(1000000),
  offline: z.boolean(),
});

export type SettingsFormValues = z.infer<typeof settingsSchema>;

export const defaultSettings: SettingsFormValues = {
  provider: 'openrouter',
  model: '',
  theme: 'auto',
  tokenBudget: 64000,
  offline: false,
};

export interface SettingsFormProps {
  onSubmit: (values: SettingsFormValues) => void;
  defaultValues?: SettingsFormValues;
}

/**
 * SettingsForm: provider/model/theme/budget/offline fields wired through
 * `useForm` + `zodResolver(settingsSchema)`. Validation runs on submit
 * (`noValidate` keeps native bubbles from pre-empting zod); each failing
 * field gets a `role="alert"` message linked via `aria-describedby`.
 * The submit callback is synchronous void — persistence arrives with the
 * settings API (P-225); nothing here throws.
 */
export function SettingsForm({
  onSubmit,
  defaultValues = defaultSettings,
}: SettingsFormProps): JSX.Element {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues,
  });
  const onValid: SubmitHandler<SettingsFormValues> = values => {
    onSubmit(values);
  };

  return (
    <form
      aria-label="Settings"
      noValidate
      onSubmit={handleSubmit(onValid)}
      className="bg-stitch-50 text-stitch-900 dark:bg-stitch-950 dark:text-stitch-50"
    >
      <div>
        <label htmlFor="settings-provider">Provider</label>
        <select id="settings-provider" {...register('provider')}>
          <option value="openrouter">openrouter</option>
          <option value="anthropic">anthropic</option>
          <option value="ollama">ollama</option>
        </select>
        {errors.provider !== undefined && (
          <p role="alert" id="settings-provider-error">
            {errors.provider.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="settings-model">Model</label>
        <input
          id="settings-model"
          type="text"
          aria-invalid={errors.model !== undefined}
          aria-describedby={errors.model !== undefined ? 'settings-model-error' : undefined}
          {...register('model')}
        />
        {errors.model !== undefined && (
          <p role="alert" id="settings-model-error">
            {errors.model.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="settings-theme">Theme</label>
        <select id="settings-theme" {...register('theme')}>
          <option value="light">light</option>
          <option value="dark">dark</option>
          <option value="auto">auto</option>
        </select>
        {errors.theme !== undefined && (
          <p role="alert" id="settings-theme-error">
            {errors.theme.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="settings-budget">Token budget</label>
        <input
          id="settings-budget"
          type="number"
          aria-invalid={errors.tokenBudget !== undefined}
          aria-describedby={errors.tokenBudget !== undefined ? 'settings-budget-error' : undefined}
          {...register('tokenBudget', { valueAsNumber: true })}
        />
        {errors.tokenBudget !== undefined && (
          <p role="alert" id="settings-budget-error">
            {errors.tokenBudget.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="settings-offline">Offline mode</label>
        <input id="settings-offline" type="checkbox" {...register('offline')} />
        {errors.offline !== undefined && (
          <p role="alert" id="settings-offline-error">
            {errors.offline.message}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="bg-stitch-700 text-stitch-50 dark:bg-stitch-200 dark:text-stitch-950"
      >
        Save settings
      </button>
    </form>
  );
}
