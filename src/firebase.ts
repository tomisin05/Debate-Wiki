import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// const VITE_FIREBASE_API_KEY = import.meta.env.VITE_FIREBASE_API_KEY;
// const VITE_FIREBASE_AUTH_DOMAIN = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
// const VITE_FIREBASE_PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
// const VITE_FIREBASE_STORAGE_BUCKET = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET;
// const VITE_FIREBASE_MESSAGING_SENDER_ID = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID;
// const VITE_FIREBASE_APP_ID = import.meta.env.VITE_FIREBASE_APP_ID;


const VITE_FIREBASE_API_KEY="AIzaSyDk0616FWEGIGFVXRsJVvT7VCXqB5t4LiA";
const VITE_FIREBASE_AUTH_DOMAIN="debate-wiki-3b5c8.firebaseapp.com";
const VITE_FIREBASE_PROJECT_ID="debate-wiki-3b5c8";
const VITE_FIREBASE_STORAGE_BUCKET="debate-wiki-3b5c8.firebasestorage.app";
const VITE_FIREBASE_MESSAGING_SENDER_ID="872076263143";
const VITE_FIREBASE_APP_ID="1:872076263143:web:0c9d4cda9559a0362d2c42";


const firebaseConfig = {
  apiKey: VITE_FIREBASE_API_KEY,
  authDomain: VITE_FIREBASE_AUTH_DOMAIN,
  projectId: VITE_FIREBASE_PROJECT_ID,
  storageBucket: VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
