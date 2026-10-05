// Budget Reset - Firebase Web App configuration
// Replace the empty values with the Firebase configuration generated
// by Firebase Console > Project settings > Your apps > Web app.
//
// This client configuration is not a password or service-account secret.
// Never put Firebase Admin SDK credentials or private keys in this file.

export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

export const firebaseConfigured =
  Object.values(firebaseConfig).every(value => typeof value === "string" && value.trim() !== "");
