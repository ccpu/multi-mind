/**
 * Port of `Multi Mind/HistoryManager.cs`. Behaviour, including the quirk that
 * `saveState` parks the cursor one past the end of the list, is unchanged.
 */
export class HistoryManager {
  #history: string[] = [];
  #currentIndex = -1;

  /** Adds a new state to the history. */
  saveState(text: string): void {
    this.#history.push(text);
    this.#currentIndex = this.#history.length;
  }

  /** Moves to the previous state in the history. */
  previous(): void {
    if (this.#currentIndex > 0) {
      this.#currentIndex--;
    }
  }

  /** Moves to the next state in the history. */
  next(): void {
    if (this.#currentIndex < this.#history.length - 1) {
      this.#currentIndex++;
    }
  }

  /** Gets the current state from the history. */
  getCurrentText(): string {
    return this.#currentIndex >= 0 ? (this.#history[this.#currentIndex] ?? '') : '';
  }
}
