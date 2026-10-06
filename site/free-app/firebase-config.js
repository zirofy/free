// Budget Reset - Firebase Web App configuration
// This client configuration identifies the Firebase project used by Budget Reset.
// Do not place Firebase Admin SDK credentials or private keys in this file.

export const firebaseConfig = {
  apiKey: "AIzaSyDe1GIlCMOLw_s1MuAlZ4erYw7HWveW_A8",
  authDomain: "budget-reset-36b88.firebaseapp.com",
  projectId: "budget-reset-36b88",
  storageBucket: "budget-reset-36b88.firebasestorage.app",
  messagingSenderId: "67129669849",
  appId: "1:67129669849:web:7df1e45a9f7eeca1f0a6c8"
};

export const firebaseConfigured =
  Object.values(firebaseConfig).every(value => typeof value === "string" && value.trim() !== "");
