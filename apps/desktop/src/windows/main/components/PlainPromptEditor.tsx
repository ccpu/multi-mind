import type { ChangeEvent, KeyboardEvent, Ref } from 'react';
import type { PromptEditorHandle, PromptEditorProps } from '../types/prompt-editor';
import { Textarea } from '@pixpilot/shadcn';
import { useCallback, useImperativeHandle, useRef } from 'react';

/**
 * The prompt box as the WinForms `textBoxPropt` was: a plain multiline box,
 * with nothing between the user and the text.
 */
export function PlainPromptEditor({
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
  const elementRef = useRef<HTMLTextAreaElement | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => elementRef.current?.focus(),
    selectAll: () => elementRef.current?.select(),
    contains: (node: Node) => elementRef.current?.contains(node) === true,
  }));

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      onChange(event.target.value);
      onActivate();
    },
    [onChange, onActivate],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.ctrlKey && event.key === 'Enter') {
        onSubmit();
        event.preventDefault();
        return;
      }

      if (event.ctrlKey && event.shiftKey) {
        switch (event.key.toLowerCase()) {
          case 'z':
            onPreviousPrompt();
            event.preventDefault();
            break;
          case 'y':
            onNextPrompt();
            event.preventDefault();
            break;
          default:
            break;
        }
      } else if (event.key === 'Escape') {
        onDismiss();
      }
    },
    [onSubmit, onPreviousPrompt, onNextPrompt, onDismiss],
  );

  return (
    <Textarea
      ref={elementRef}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onClick={onActivate}
      className="field-sizing-fixed h-full min-h-0 min-w-0 flex-1 resize-none overflow-y-auto text-base md:text-base"
    />
  );
}
