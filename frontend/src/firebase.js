import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

// Override with VITE_FIREBASE_* env vars to point at a different Firebase project (no code change).
const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyBfrtpkXRHnff_q-mxOV_ScZVxoPbarauY",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "travi-vibesprint.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "travi-vibesprint",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "travi-vibesprint.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "511331436266",
  appId: env.VITE_FIREBASE_APP_ID || "1:511331436266:web:77ef24ca425eb156ea3993",
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || "G-H7TR0EDNVB",
};

// Initialize Firebase (check if already initialized for HMR)
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Initialize Cloud Firestore and get a reference to the service
export const db = getFirestore(app);

export default app;
