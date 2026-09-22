/**
 * Marks a box as part of the prompt box rather than somewhere else in the
 * window, so pressing it does not count as clicking away and collapse the
 * panel. An attribute rather than a ref, because the preset editors are
 * portalled to the end of the document and are nowhere near the panel in the
 * tree.
 */
export const PROMPT_SURFACE_ATTRIBUTE = 'data-prompt-surface';

export const PROMPT_SURFACE_SELECTOR = `[${PROMPT_SURFACE_ATTRIBUTE}]`;

/** Spread onto whatever belongs to the prompt box. */
export const promptSurface = { [PROMPT_SURFACE_ATTRIBUTE]: '' } as const;
