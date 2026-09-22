/**
 * What the prompt box looks like to the rest of the app, so that the plain
 * textarea and the EasyMDE editor are interchangeable. Neither a CodeMirror
 * instance nor a textarea is exposed past this point.
 */
export interface PromptEditorHandle {
  focus: () => void;
  /** Selects the whole prompt, for the third-click gesture. */
  selectAll: () => void;
  /**
   * Whether a node is inside the editor. The main window collapses the prompt
   * box when a press lands outside it, and EasyMDE's DOM is a tree of its own
   * rather than the textarea it replaced.
   */
  contains: (node: Node) => boolean;
}

export interface PromptEditorProps {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  /** The prompt box was typed in or clicked, so it should be at full size. */
  onActivate: () => void;
  /** Ctrl+Enter. */
  onSubmit: () => void;
  /** Ctrl+Shift+Z. */
  onPreviousPrompt: () => void;
  /** Ctrl+Shift+Y. */
  onNextPrompt: () => void;
  /** Escape. */
  onDismiss: () => void;
}
