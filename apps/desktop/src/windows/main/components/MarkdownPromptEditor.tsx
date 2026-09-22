import type { Ref } from 'react';
import type { PromptEditorHandle, PromptEditorProps } from '../types/prompt-editor';
import EasyMDE from 'easymde';
import { useEffect, useImperativeHandle, useRef } from 'react';

/**
 * The prompt box as an [EasyMDE](https://github.com/Ionaru/easy-markdown-editor)
 * editor, which is what the prompts mostly are: markdown.
 *
 * The toolbar is off. EasyMDE draws it with Font Awesome classes, which this
 * app does not ship, and the prompt box is a tenth of the window by default —
 * there is no room for one. The parts that matter are still there: syntax
 * highlighting, lists that carry on by themselves, and the Ctrl+B / Ctrl+I
 * style shortcuts.
 */
export function MarkdownPromptEditor({
  value,
  placeholder,
  onChange,
  onActivate,
  onSubmit,
  onPreviousPrompt,
  onNextPrompt,
  onDismiss,
  ref,
}: PromptEditorProps & { ref?: Ref<PromptEditorHandle> }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLTextAreaElement | null>(null);
  const editorRef = useRef<EasyMDE | null>(null);

  // CodeMirror is built once and then lives outside React, so it reads the
  // current props through a ref rather than closing over the first ones.
  const propsRef = useRef({
    value,
    onChange,
    onActivate,
    onSubmit,
    onPreviousPrompt,
    onNextPrompt,
    onDismiss,
  });
  propsRef.current = {
    value,
    onChange,
    onActivate,
    onSubmit,
    onPreviousPrompt,
    onNextPrompt,
    onDismiss,
  };

  /**
   * True while the prompt is being pushed in from outside — a submit clearing
   * it, the history, a guest page mirroring its own box. CodeMirror fires
   * `change` for those too, and letting one through would expand the panel the
   * submit had just collapsed.
   */
  const syncingRef = useRef(false);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.codemirror.focus(),
    selectAll: () => editorRef.current?.codemirror.execCommand('selectAll'),
    contains: (node: Node) => containerRef.current?.contains(node) === true,
  }));

  useEffect(() => {
    const element = hostRef.current;
    if (element === null) {
      return undefined;
    }

    const editor = new EasyMDE({
      element,
      initialValue: propsRef.current.value,
      placeholder,
      toolbar: false,
      status: false,
      spellChecker: false,
      lineWrapping: true,
      autoDownloadFontAwesome: false,
      minHeight: '0',
      // The prompt box is sized by its panel, so EasyMDE must not also restore
      // a height of its own from a previous session.
      autosave: { enabled: false, uniqueId: 'multi-mind-prompt', delay: 1000 },
    });

    const { codemirror } = editor;

    codemirror.on('change', () => {
      if (syncingRef.current) {
        return;
      }

      propsRef.current.onChange(editor.value());
      propsRef.current.onActivate();
    });

    codemirror.on('focus', () => propsRef.current.onActivate());

    // Added at the top of the keymap stack, so these win over CodeMirror's own
    // bindings — Shift-Ctrl-Z is redo by default, and here it is the history.
    codemirror.addKeyMap({
      'Ctrl-Enter': () => propsRef.current.onSubmit(),
      'Shift-Ctrl-Z': () => propsRef.current.onPreviousPrompt(),
      'Shift-Ctrl-Y': () => propsRef.current.onNextPrompt(),
      Esc: () => propsRef.current.onDismiss(),
    });

    editorRef.current = editor;

    return () => {
      editorRef.current = null;
      // Puts the original textarea back, which is what lets React unmount the
      // subtree without CodeMirror's nodes left behind in it.
      editor.toTextArea();
    };
  }, [placeholder]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null || editor.value() === value) {
      return;
    }

    syncingRef.current = true;
    editor.value(value);
    syncingRef.current = false;
  }, [value]);

  return (
    <div ref={containerRef} className="multi-mind-markdown-prompt min-w-0 flex-1">
      <textarea ref={hostRef} defaultValue={value} />
    </div>
  );
}
