'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth, isAdminFirebaseConfigured } from '../../lib/firebase';

export default function AdminLoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    if (!auth) {
      setError('Firebase Web SDK is not configured.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Admin authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAF9] p-6">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8">
        <h1 className="text-xl font-bold text-slate-900">GreenGate Admin Console</h1>
        <p className="mt-2 text-sm text-slate-600">
          Sign in with your authorized staff Google account. Administrator privileges are verified server-side.
        </p>
        {!isAdminFirebaseConfigured() ? (
          <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
            Firebase configuration pending. Set NEXT_PUBLIC_FIREBASE_* environment variables.
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        ) : null}
        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="mt-6 w-full py-2.5 px-4 rounded-lg bg-[#0F3D2E] text-white text-sm font-medium hover:bg-[#0B2E22]"
        >
          {loading ? 'Signing in...' : 'Sign In with Google'}
        </button>
      </div>
    </div>
  );
}
