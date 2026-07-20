import { useCallback, useEffect, useState } from 'react';
import type { User } from '@/app/pos/types';
import { getPosApiBase, setStoredAuthToken } from '@/lib/apiBase';

const LOGIN_KEY = 'isLoggedIn';
const USER_KEY = 'currentUser';

// Keeps current localStorage-based session behavior isolated in one place.
export function useAuth() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthRestored, setIsAuthRestored] = useState(false);
  const [selectedLoginUser, setSelectedLoginUser] = useState<User | null>(null);
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState(false);

  useEffect(() => {
    const savedLogin = localStorage.getItem(LOGIN_KEY);
    const savedUser = localStorage.getItem(USER_KEY);
    if (savedLogin === 'true' && savedUser) {
      try {
        const parsed = JSON.parse(savedUser) as User;
        setCurrentUser(parsed);
        setIsLoggedIn(true);
      } catch {
        localStorage.removeItem(USER_KEY);
        localStorage.setItem(LOGIN_KEY, 'false');
      }
    }
    setIsAuthRestored(true);
  }, []);

  useEffect(() => {
    if (!isAuthRestored) return;
    localStorage.setItem(LOGIN_KEY, String(isLoggedIn));
    if (currentUser) {
      localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
    } else {
      localStorage.removeItem(USER_KEY);
    }
    window.dispatchEvent(new Event('pos-auth-changed'));
  }, [isLoggedIn, currentUser, isAuthRestored]);

  const login = useCallback(async () => {
    const selectedUser = selectedLoginUser;
    const userId = selectedUser?.id;
    const enteredPin = String(loginPassword).trim();
    const isPinValid = /^\d{4,}$/.test(enteredPin);

    if (!userId || !isPinValid) {
      setLoginError(true);
      window.setTimeout(() => setLoginError(false), 500);
      return false;
    }

    try {
      const response = await fetch(`${getPosApiBase()}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          enteredPin,
        }),
      });

      if (response.status === 401) {
        window.alert('PIN incorreto');
        setLoginError(true);
        window.setTimeout(() => setLoginError(false), 500);
        return false;
      }

      if (!response.ok) {
        setLoginError(true);
        window.setTimeout(() => setLoginError(false), 500);
        return false;
      }

      const payload = await response.json();
      const loggedUser: User = {
        ...selectedUser,
        ...(payload?.user ?? {}),
        accessLevel: Number(payload?.user?.access_level ?? payload?.user?.accessLevel ?? selectedUser.accessLevel ?? 0),
        active: payload?.user?.active === false ? false : Boolean(payload?.user?.active ?? selectedUser.active ?? true),
      };

      setCurrentUser(loggedUser);
      setIsLoggedIn(true);
      setLoginError(false);
      setLoginPassword('');
      localStorage.setItem(LOGIN_KEY, 'true');
      localStorage.setItem(USER_KEY, JSON.stringify(loggedUser));
      setStoredAuthToken(payload?.token ?? null);
      window.dispatchEvent(new Event('pos-auth-changed'));
      return true;
    } catch {
      setLoginError(true);
      window.setTimeout(() => setLoginError(false), 500);
      return false;
    }
  }, [loginPassword, selectedLoginUser]);

  const logout = useCallback(() => {
    setCurrentUser(null);
    setIsLoggedIn(false);
    localStorage.setItem(LOGIN_KEY, 'false');
    localStorage.removeItem(USER_KEY);
    window.dispatchEvent(new Event('pos-auth-changed'));
  }, []);

  return {
    isLoggedIn,
    setIsLoggedIn,
    currentUser,
    setCurrentUser,
    isAuthRestored,
    selectedLoginUser,
    setSelectedLoginUser,
    loginPassword,
    setLoginPassword,
    loginError,
    login,
    logout,
  };
}
