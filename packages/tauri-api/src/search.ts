import { invoke } from '@tauri-apps/api/core';

/** One persisted prompt and its latest known conversation address. */
export interface SearchEntry {
  id: number;
  websiteId: string;
  prompt: string;
  title: string;
  url: string;
}

/** Saves a submitted prompt for one provider. */
export async function searchAddPrompt(
  websiteId: string,
  prompt: string,
): Promise<number> {
  return invoke<number>('search_add_prompt', { websiteId, prompt });
}

/** Updates the conversation metadata for a saved prompt. */
export async function searchUpdatePrompt(
  id: number,
  title: string,
  url: string,
): Promise<void> {
  return invoke<void>('search_update_prompt', { id, title, url });
}

/** Finds prompt, title, and URL substrings in saved records. */
export async function searchPrompts(query: string): Promise<SearchEntry[]> {
  return invoke<SearchEntry[]>('search_prompts', { query });
}
