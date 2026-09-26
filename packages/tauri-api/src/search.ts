import { invoke } from '@tauri-apps/api/core';

/** The conversation a saved prompt started on one provider. */
export interface SearchConversation {
  id: number;
  websiteId: string;
  title: string;
  url: string;
}

/** One submitted prompt and every conversation it started. */
export interface SearchEntry {
  id: number;
  prompt: string;
  /** SQLite UTC timestamp, `YYYY-MM-DD HH:MM:SS`. */
  createdAt: string;
  conversations: SearchConversation[];
}

/** Saves a submitted prompt once, whichever providers it went to. */
export async function searchAddPrompt(prompt: string): Promise<number> {
  return invoke<number>('search_add_prompt', { prompt });
}

/** Links a provider that accepted a saved prompt, returning the conversation id. */
export async function searchAddConversation(
  promptId: number,
  websiteId: string,
): Promise<number> {
  return invoke<number>('search_add_conversation', { promptId, websiteId });
}

/** Updates the address and title of a saved conversation. */
export async function searchUpdateConversation(
  id: number,
  title: string,
  url: string,
): Promise<void> {
  return invoke<void>('search_update_conversation', { id, title, url });
}

/**
 * Finds prompts whose text, conversation titles, or URLs hold every word of the
 * query, best matches first. An empty query lists the most recent prompts.
 */
export async function searchPrompts(query: string): Promise<SearchEntry[]> {
  return invoke<SearchEntry[]>('search_prompts', { query });
}
