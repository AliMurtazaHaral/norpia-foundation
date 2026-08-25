/**
 * Authentication Layer (Week 3) — centralized Supabase Auth state.
 *
 * The single source of truth for: session, user, profile, role, loading and
 * email-verification status. No page implements auth logic on its own.
 */

import type { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { supabase } from "@/lib/supabase/client";

export type AppRole = "administrator" | "standard_user";

export interface UserProfile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: AppRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface SignUpInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  role: AppRole | null;
  isAuthenticated: boolean;
  isEmailVerified: boolean;
  isLoading: boolean;
  signUp: (input: SignUpInput) => Promise<{ needsEmailVerification: boolean }>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  updateProfile: (input: { firstName: string; lastName: string }) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, first_name, last_name, role, is_active, created_at, updated_at")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      setProfile(null);
      return;
    }
    setProfile((data as UserProfile) ?? null);
  }, []);

  useEffect(() => {
    let active = true;

    // 1) Register the listener first so no transition is missed.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (nextSession?.user) {
        // Defer the Supabase call out of the callback to avoid deadlocks.
        setTimeout(() => void loadProfile(nextSession.user.id), 0);
      } else {
        setProfile(null);
      }
    });

    // 2) Restore any existing session.
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session?.user) await loadProfile(data.session.user.id);
      setIsLoading(false);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signUp = useCallback(async (input: SignUpInput) => {
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo: `${window.location.origin}/verify-email`,
        // Role is deliberately NOT accepted from the client.
        data: { first_name: input.firstName, last_name: input.lastName },
      },
    });
    if (error) throw error;
    return { needsEmailVerification: !data.session };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }, []);

  const resendVerification = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/verify-email` },
    });
    if (error) throw error;
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  }, []);

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) await loadProfile(data.user.id);
  }, [loadProfile]);

  const updateProfile = useCallback(
    async (input: { firstName: string; lastName: string }) => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("profiles")
        .update({ first_name: input.firstName, last_name: input.lastName })
        .eq("id", data.user.id);
      if (error) throw error;
      await loadProfile(data.user.id);
    },
    [loadProfile],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      role: profile?.role ?? null,
      isAuthenticated: Boolean(session?.user),
      isEmailVerified: Boolean(session?.user?.email_confirmed_at),
      isLoading,
      signUp,
      signIn,
      signOut,
      resendVerification,
      requestPasswordReset,
      updatePassword,
      updateProfile,
      refreshProfile,
    }),
    [
      session,
      profile,
      isLoading,
      signUp,
      signIn,
      signOut,
      resendVerification,
      requestPasswordReset,
      updatePassword,
      updateProfile,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
