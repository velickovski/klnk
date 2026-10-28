import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText, ResponseFence } from './panel-state';

/** Serial operations prevent double taps; every callback is scoped to this mounted owner. */
export function usePanelTask() {
  const fence = useRef(new ResponseFence()),
    lock = useRef<{ guard: ResponseFence; ticket: number } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    fence.current = new ResponseFence();
    return () => {
      fence.current.dispose();
    };
  }, []);
  const run = useCallback(
    async <T>(operation: () => Promise<T>, commit: (result: T) => void, prefix = '') => {
      if (lock.current?.guard.current(lock.current.ticket)) return;
      const guard = fence.current,
        ticket = guard.begin();
      if (!guard.current(ticket)) return;
      const reservation = { guard, ticket };
      lock.current = reservation;
      setBusy(true);
      setError('');
      setNotice('');
      try {
        const result = await operation();
        if (guard.current(ticket)) commit(result);
      } catch (failure) {
        if (guard.current(ticket)) setError(`${prefix}${errorText(failure)}`);
      } finally {
        if (lock.current === reservation) lock.current = null;
        if (guard.current(ticket)) setBusy(false);
      }
    },
    [],
  );
  return { busy, error, notice, setError, setNotice, run };
}
