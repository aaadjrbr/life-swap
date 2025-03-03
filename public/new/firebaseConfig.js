// Import Firebase modules directly from the CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
  getFirestore,
  arrayUnion, 
  arrayRemove, 
  collection, 
  runTransaction,
  limitToLast,
  deleteDoc, 
  writeBatch, 
  collectionGroup,
  doc, 
  query, 
  where, 
  limit, 
  orderBy, 
  getDocs,
  getDoc, 
  setDoc, 
  addDoc, 
  startAfter,
  updateDoc, 
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
  getStorage, 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// Firebase configuration object
const firebaseConfig = {
  apiKey: "AIzaSyB5Q0kHoViWJl-t-pWCKj_AT-ClAMadfrU",
  authDomain: "life-swap-6065e.firebaseapp.com",
  projectId: "life-swap-6065e",
  storageBucket: "life-swap-6065e.firebasestorage.app",
  messagingSenderId: "475311181000",
  appId: "1:475311181000:web:32d03d80f70081bfb629fd",
  measurementId: "G-CHJY2ZEYYF"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Services
const db = getFirestore(app);              // Firestore database
const auth = getAuth(app);                 // Authentication
const storage = getStorage(app);           // Storage
const analytics = getAnalytics(app);       // Analytics
const functions = getFunctions(app);       // Cloud Functions
const realtimeDb = getDatabase(app);       // Realtime Database

// Export all initialized services and utilities
export {
  // Core services
  app,
  db,
  auth,
  getAuth,
  initializeApp,
  storage,
  analytics,
  functions,
  realtimeDb,

  // Firestore utilities
  collection,
  getFirestore,
  runTransaction,
  arrayUnion,
  doc,
  query,
  where,
  limit,
  limitToLast,
  updateDoc,  
  writeBatch, 
  collectionGroup,
  orderBy,
  getDocs,
  startAfter,
  arrayRemove,
  setDoc,
  addDoc,
  getDoc,
  deleteDoc,
  onSnapshot,

  // Authentication utilities
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,

  // Storage utilities
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
};