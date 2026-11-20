'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import type { RoleDefinition, StaffMember } from '@society-marketplace/shared-types';
import { hasGranularPermission } from '@society-marketplace/business-logic';
import { auth, db, isAdminFirebaseConfigured } from '../lib/firebase';

const BOOTSTRAP_ADMIN_EMAIL = 'sandeeprana4519@gmail.com';

export interface AdminAuthState {
  user: User | null;
  staff: StaffMember | null;
  role: RoleDefinition | null;
  permissions: string[];
  can: (perm: string) => boolean;
  authorized: boolean;
  loading: boolean;
  configMissing: boolean;
}

export function useAdminAuth(): AdminAuthState {
  const [state, setState] = useState<Omit<AdminAuthState, 'can'>>({
    user: null,
    staff: null,
    role: null,
    permissions: [],
    authorized: false,
    loading: true,
    configMissing: !isAdminFirebaseConfigured(),
  });

  useEffect(() => {
    if (!auth || !db) {
      setState((prev) => ({ ...prev, loading: false, configMissing: true }));
      return;
    }

    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        document.cookie = 'gg_admin_session=; path=/; max-age=0';
        setState({
          user: null,
          staff: null,
          role: null,
          permissions: [],
          authorized: false,
          loading: false,
          configMissing: false,
        });
        return;
      }

      const isBootstrap = Boolean(user.emailVerified && user.email === BOOTSTRAP_ADMIN_EMAIL);

      try {
        const staffSnap = await getDoc(doc(db!, 'staff', user.uid));
        if (!staffSnap.exists()) {
          if (isBootstrap) {
            document.cookie = `gg_admin_session=1; path=/; SameSite=Lax`;
          }
          setState({
            user,
            staff: null,
            role: null,
            permissions: isBootstrap ? ['*'] : [],
            authorized: isBootstrap,
            loading: false,
            configMissing: false,
          });
          return;
        }

        const staff = staffSnap.data() as StaffMember;
        const roleSnap = await getDoc(doc(db!, 'roles', staff.roleId));
        const role = roleSnap.exists() ? (roleSnap.data() as RoleDefinition) : null;
        const staffAuthorized = Boolean(
          user.emailVerified && staff.status === 'active' && role && role.permissions.length > 0
        );
        const authorized = isBootstrap || staffAuthorized;
        const permissions = isBootstrap ? ['*'] : role?.permissions ?? [];

        if (authorized) {
          document.cookie = `gg_admin_session=1; path=/; SameSite=Lax`;
        } else {
          document.cookie = 'gg_admin_session=; path=/; max-age=0';
        }

        setState({
          user,
          staff,
          role,
          permissions,
          authorized,
          loading: false,
          configMissing: false,
        });
      } catch {
        setState({
          user,
          staff: null,
          role: null,
          permissions: isBootstrap ? ['*'] : [],
          authorized: isBootstrap,
          loading: false,
          configMissing: false,
        });
      }
    });
  }, []);

  return {
    ...state,
    can: (perm: string) => hasGranularPermission(state.permissions, perm),
  };
}
