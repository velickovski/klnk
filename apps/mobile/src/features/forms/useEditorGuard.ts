import { useEffect, useRef } from 'react';

export type EditorGuard = {
  onDirtyChange?: (dirty: boolean) => void;
  onRegisterSave?: (save: (() => void) | null) => void;
};

/** Keep dismissal decisions with the shell, and validation with the editor. */
export function useEditorGuard(
  value: unknown,
  save: () => void,
  { onDirtyChange, onRegisterSave }: EditorGuard,
) {
  const serialized = JSON.stringify(value);
  const initial = useRef(serialized);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    onDirtyChange?.(serialized !== initial.current);
  }, [serialized, onDirtyChange]);
  useEffect(() => {
    onRegisterSave?.(() => saveRef.current());
    return () => onRegisterSave?.(null);
  }, [onRegisterSave]);
}
