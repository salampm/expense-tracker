/**
 * Firebase Config - Modular SDK (v10+)
 * Using imports from the Import Map in index.html
 */

import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Firebase configuration (Frontend-safe only)
const firebaseConfig = {
  apiKey: "AIzaSyCamHOZdnXdKaKg_9rqI3LdEI7srQKLiGM",
  authDomain: "expensetracker-2fb92.firebaseapp.com",
  projectId: "expensetracker-2fb92",
  storageBucket: "expensetracker-2fb92.firebasestorage.app",
  messagingSenderId: "261484355674",
  appId: "1:261484355674:web:6f322df6f5a4c83080f863"
};

// Initialize Firebase once
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Services
export const auth = getAuth(app);
export const db = getFirestore(app);

// Enable Offline Support (Optional but recommended)
try {
  enableIndexedDbPersistence(db).catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn("Multiple tabs open - Firebase persistence only active in one.");
    } else if (err.code === 'unimplemented') {
      console.warn("Browser does not support Firebase persistence.");
    }
  });
} catch (e) {
  console.log("Firebase persistence skipped.");
}
