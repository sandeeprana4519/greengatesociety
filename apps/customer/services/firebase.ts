import firebase from '@react-native-firebase/app';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import functions from '@react-native-firebase/functions';

export interface CustomerFirebaseStatus {
  configured: boolean;
  projectId: string | null;
  error?: string;
}

export function getCustomerFirebaseStatus(): CustomerFirebaseStatus {
  try {
    if (firebase.apps.length === 0) {
      return {
        configured: false,
        projectId: null,
        error:
          'Native Firebase configuration missing. Add google-services.json (Android) and GoogleService-Info.plist (iOS) and rebuild the Expo Dev Client.',
      };
    }
    const app = firebase.app();
    return {
      configured: Boolean(app.options.projectId),
      projectId: app.options.projectId ?? null,
    };
  } catch (err) {
    return {
      configured: false,
      projectId: null,
      error: err instanceof Error ? err.message : 'Firebase initialization error',
    };
  }
}

export const customerAuth = auth;
export const customerFirestore = firestore;
export const customerFunctions = functions;
