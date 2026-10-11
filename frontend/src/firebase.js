import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

// Override with VITE_FIREBASE_* env vars to point at a different Firebase project (no code change).
const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyAFFeWHk2utN48at8YgMks6Ffv4C-WjTlM",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "travi-cd6fa.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "travi-cd6fa",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "travi-cd6fa.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "250617724054",
  appId: env.VITE_FIREBASE_APP_ID || "1:250617724054:web:53cc49a06ea9e3bc49d6b7",
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || "G-SPK0S508E2",
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
