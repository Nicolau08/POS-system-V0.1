import { useCallback, useEffect, useState } from 'react';
import type { User } from '@/app/pos/types';

const LOGIN_KEY = 'isLoggedIn';
const USER_KEY = 'currentUser';

// Keeps current localStorage-based session behavior isolated in one place.
export function useAuth(users: User[]) {
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

  const login = useCallback(() => {
    const foundUser = users.find((u) => u.id === selectedLoginUser?.id);
    if (foundUser && loginPassword === foundUser.password) {
      setCurrentUser(foundUser);
      setIsLoggedIn(true);
      setLoginError(false);
      setLoginPassword('');
      localStorage.setItem(LOGIN_KEY, 'true');
      localStorage.setItem(USER_KEY, JSON.stringify(foundUser));
      window.dispatchEvent(new Event('pos-auth-changed'));
      return true;
    }

    setLoginError(true);
    window.setTimeout(() => setLoginError(false), 500);
    return false;
  }, [loginPassword, selectedLoginUser, users]);

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
