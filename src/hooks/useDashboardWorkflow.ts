import { useEffect, useRef, useState } from 'react';
import {
  BackgroundClientError,
  createBackgroundClient,
  type BackgroundClient,
} from '../messaging/background-client';
import type { StorageSnapshot } from '../storage/repository';

export type DashboardNoticeTone = 'success' | 'error';

export interface DashboardNotice {
  tone: DashboardNoticeTone;
  message: string;
}

export type DashboardViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snapshot: StorageSnapshot };

export interface DashboardWorkflow {
  state: DashboardViewState;
  refreshingCollection: boolean;
  notice: DashboardNotice | null;
  reload(): void;
  refreshCollection(): Promise<void>;
}

export interface DashboardWorkflowOptions {
  client?: BackgroundClient;
}

const defaultClient = createBackgroundClient();

function errorMessage(error: unknown): string {
  if (error instanceof BackgroundClientError) {
    return error.message;
  }
  return 'Something went wrong. Try again.';
}

export function useDashboardWorkflow(
  options: DashboardWorkflowOptions = {},
): DashboardWorkflow {
  const client = options.client ?? defaultClient;

  const [state, setState] = useState<DashboardViewState>({ status: 'loading' });
  const [refreshingCollection, setRefreshingCollection] = useState(false);
  const [notice, setNotice] = useState<DashboardNotice | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const mountedRef = useRef(false);
  const busyRef = useRef(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    void (async () => {
      try {
        const snapshot = await client.getSnapshot();
        if (!mountedRef.current || requestId !== requestIdRef.current) {
          return;
        }
        setState({ status: 'ready', snapshot });
      } catch (error) {
        if (!mountedRef.current || requestId !== requestIdRef.current) {
          return;
        }
        setState({ status: 'error', message: errorMessage(error) });
      }
    })();

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [client, reloadToken]);

  function reload(): void {
    if (busyRef.current) {
      return;
    }
    setState({ status: 'loading' });
    setNotice(null);
    setReloadToken((value) => value + 1);
  }

  async function refreshCollection(): Promise<void> {
    if (busyRef.current || state.status !== 'ready') {
      return;
    }

    busyRef.current = true;
    setRefreshingCollection(true);
    setNotice(null);
    try {
      const snapshot = await client.getSnapshot();
      if (!mountedRef.current) {
        return;
      }
      setState({ status: 'ready', snapshot });
      setNotice({ tone: 'success', message: 'The collection was refreshed.' });
    } catch (error) {
      if (mountedRef.current) {
        setNotice({ tone: 'error', message: errorMessage(error) });
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) {
        setRefreshingCollection(false);
      }
    }
  }

  return {
    state,
    refreshingCollection,
    notice,
    reload,
    refreshCollection,
  };
}
