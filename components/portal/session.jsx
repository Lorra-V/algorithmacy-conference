'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SAMPLE_ID, bindSampleUser, resetSample, sampleAccount } from '../../assets/js/portal/sample.js';
import { api, loadAuth, setPreviewAccount, signOutUser, storeMfa, waitForUser } from './client';
import { isEngineer, personName } from './format';

const VIEW_KEY = 'studioView';
const PREVIEW_KEY = 'studioPreview';
const memoryStore = {};

function storeGet(key) {
  try {
    const value = sessionStorage.getItem(key);
    if (value != null) return value;
  } catch (e) { /* private mode */ }
  return memoryStore[key] || '';
}

function storeSet(key, value) {
  memoryStore[key] = value;
  try { sessionStorage.setItem(key, value); } catch (e) { /* private mode */ }
}

function viewModeOf(viewer) {
  if (!viewer || !isEngineer(viewer.user)) return 'client';
  const stored = storeGet(VIEW_KEY);
  if (stored === 'client' || stored === 'engineer') return stored;
  if (viewer.user.engineerProfile === 'needed') return 'engineer';
  return viewer.account ? 'client' : 'engineer';
}

async function officeChoices() {
  const choices = [{ id: SAMPLE_ID, office: 'Harbor & Finch (sample)' }];
  try {
    const data = await api('admin/accounts');
    (data.accounts || []).forEach((account) => {
      choices.push({ id: account.id, office: account.office || 'Account' });
    });
  } catch (e) { /* the sample office still opens */ }
  return choices;
}

async function present(viewer, mode) {
  setPreviewAccount('');
  if (!viewer || !isEngineer(viewer.user)) return viewer;
  const choices = await officeChoices();
  if (mode !== 'client') return { ...viewer, previewChoices: choices };
  const ownId = viewer.account && viewer.account.id;
  let id = storeGet(PREVIEW_KEY);
  const known = choices.some((account) => account.id === id);
  if (!known) id = ownId || SAMPLE_ID;
  storeSet(PREVIEW_KEY, id);
  if (id === SAMPLE_ID) {
    setPreviewAccount(SAMPLE_ID);
    bindSampleUser(viewer.user.email, personName(viewer.user));
    return { user: viewer.user, account: sampleAccount(), previewChoices: choices };
  }
  if (ownId && id === ownId) {
    return { user: viewer.user, account: viewer.account, previewChoices: choices };
  }
  setPreviewAccount(id);
  const overlay = await api('me');
  return { user: overlay.user, account: overlay.account, previewChoices: choices };
}

const PortalContext = createContext(null);

export function usePortal() {
  const value = useContext(PortalContext);
  if (!value) throw new Error('Portal session is missing.');
  return value;
}

export function PortalSession({ children }) {
  const router = useRouter();
  const [status, setStatus] = useState('loading');
  const [viewer, setViewer] = useState(null);
  const [presented, setPresented] = useState(null);
  const [mode, setMode] = useState('client');
  const [tick, setTick] = useState(0);
  const [revision, setRevision] = useState(0);
  const [mfa, setMfa] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (window.location.pathname.startsWith('/portal/login')) {
        if (!cancel) setStatus('bare');
        return;
      }
      const auth = await loadAuth();
      if (!auth) {
        if (!cancel) setStatus('unconfigured');
        return;
      }
      const user = await waitForUser(auth);
      if (!user) {
        const next = window.location.pathname + window.location.search;
        window.location.href = '/portal/login/?next=' + encodeURIComponent(next);
        return;
      }
      const me = await api('me');
      if (me && me.user && user.providerData) {
        me.user.google = user.providerData.some((entry) => entry && entry.providerId === 'google.com');
      }
      if (cancel) return;
      if (me.mfa && me.mfa !== 'ok') {
        setViewer(me);
        setMfa(me.mfa);
        setStatus('mfa');
        return;
      }
      bindSampleUser(me.user.email, personName(me.user));
      setViewer(me);
      setMode(viewModeOf(me));
      setStatus('ready');
    })().catch((err) => {
      if (!cancel) {
        setError(err.message || 'Try again.');
        setStatus('error');
      }
    });
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    if (status !== 'ready' || !viewer) return undefined;
    let cancel = false;
    present(viewer, mode).then((next) => {
      if (!cancel) setPresented(next);
    }).catch((err) => {
      if (cancel) return;
      if (err.mfa) {
        storeMfa('');
        setPreviewAccount('');
        setMfa(err.mfa);
        setStatus('mfa');
        return;
      }
      setError(err.message || 'Try again.');
      setStatus('error');
    });
    return () => { cancel = true; };
  }, [status, viewer, mode, tick]);

  const call = useCallback(async (path, opts) => {
    try {
      return await api(path, opts);
    } catch (err) {
      if (err.mfa) {
        storeMfa('');
        setPreviewAccount('');
        setMfa(err.mfa);
        setStatus('mfa');
      }
      throw err;
    }
  }, []);

  const refresh = useCallback(() => {
    setTick((value) => value + 1);
    setRevision((value) => value + 1);
  }, []);

  const setView = useCallback((next) => {
    if (next !== 'engineer' && next !== 'client') return;
    storeSet(VIEW_KEY, next);
    storeSet(PREVIEW_KEY, '');
    setPreviewAccount('');
    setMode(next);
    setTick((value) => value + 1);
    router.push(next === 'engineer' ? '/portal/admin/' : '/portal/');
  }, [router]);

  const openSample = useCallback(() => {
    storeSet(VIEW_KEY, 'client');
    storeSet(PREVIEW_KEY, SAMPLE_ID);
    setPreviewAccount(SAMPLE_ID);
    setMode('client');
    setTick((value) => value + 1);
    router.push('/portal/');
  }, [router]);

  const choosePreview = useCallback((id) => {
    if (!id) return;
    storeSet(VIEW_KEY, 'client');
    storeSet(PREVIEW_KEY, id);
    setMode('client');
    setTick((value) => value + 1);
    router.push('/portal/');
  }, [router]);

  const openClientPreview = useCallback((id, href) => {
    storeSet(VIEW_KEY, 'client');
    storeSet(PREVIEW_KEY, id);
    setMode('client');
    setTick((value) => value + 1);
    router.push(href || '/portal/');
  }, [router]);

  const resetOffice = useCallback(() => {
    resetSample();
    setTick((value) => value + 1);
  }, []);

  const finishMfa = useCallback(async () => {
    const me = await api('me');
    if (me.mfa && me.mfa !== 'ok') {
      setMfa(me.mfa);
      setStatus('mfa');
      return;
    }
    bindSampleUser(me.user.email, personName(me.user));
    setViewer(me);
    setMode(viewModeOf(me));
    setStatus('ready');
  }, []);

  const value = useMemo(() => ({
    status,
    me: presented,
    viewer,
    mode,
    mfa,
    error,
    api: call,
    refresh,
    revision,
    setView,
    openSample,
    choosePreview,
    openClientPreview,
    resetOffice,
    finishMfa,
    signOut: signOutUser,
  }), [status, presented, viewer, mode, mfa, error, call, refresh, revision, setView, openSample, choosePreview, openClientPreview, resetOffice, finishMfa]);

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}
