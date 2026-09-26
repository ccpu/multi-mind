import type { PromptPreset } from '@internal/multi-mind';
import type { ReactElement } from 'react';
import { promptPresetLabel } from '@internal/multi-mind';
import { Tooltip, TooltipContent, TooltipTrigger } from '@pixpilot/shadcn';
import { useState } from 'react';
import { clearOfBrowsers } from '../hooks/useOverlayPresence';
import { promptSurface } from './prompt-surface';

const NAME_LIST = new Intl.ListFormat('en', { type: 'conjunction' });

function overriddenMessage(overriddenBy: readonly PromptPreset[]): string {
  const names = NAME_LIST.format(
    overriddenBy.map((preset) => `“${promptPresetLabel(preset)}”`),
  );

  return overriddenBy.length === 1
    ? `Not sent while ${names} is ticked: it overrides the other prompts.`
    : `Not sent while ${names} are ticked: they override the other prompts.`;
}

interface OverriddenTooltipProps {
  /** The ticked presets leaving this one out; empty when nothing does. */
  overriddenBy: readonly PromptPreset[];
  /** What the tooltip hangs off. It has to take a ref and pointer handlers. */
  children: ReactElement;
}

/**
 * Says why a greyed-out preset is not going out, naming the ones that
 * override it. It opens below its trigger and never flips above it: the
 * browsers sit above the prompt box, and a native webview covers whatever is
 * drawn over it, so it stays where it can show without hiding them.
 *
 * It is always mounted and only kept shut while nothing is overridden, so a
 * preset becoming overridden does not remount what it wraps.
 */
export function OverriddenTooltip({ overriddenBy, children }: OverriddenTooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <Tooltip open={open && overriddenBy.length > 0} onOpenChange={setOpen}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        {...promptSurface}
        {...clearOfBrowsers}
        side="bottom"
        avoidCollisions={false}
        className="max-w-64"
      >
        {overriddenMessage(overriddenBy)}
      </TooltipContent>
    </Tooltip>
  );
}
