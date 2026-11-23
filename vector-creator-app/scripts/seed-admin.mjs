import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, setDoc, serverTimestamp } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBi4_i2vXs_1QWVIpwhTimQBZjvPu3hsPk",
  authDomain: "vector-ease.firebaseapp.com",
  projectId: "vector-ease",
  storageBucket: "vector-ease.firebasestorage.app",
  messagingSenderId: "781248054048",
  appId: "1:781248054048:web:a2a8dc45b19e5031454d45",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Usage: ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... node scripts/seed-admin.mjs
// Never write the password into this file: the repo is on GitHub.
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment first.");
  process.exit(1);
}

try {
  // Sign in with existing account
  const cred = await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);
  const uid = cred.user.uid;

  // Write superadmin record to Firestore
  await setDoc(doc(db, "users", uid), {
    uid,
    email: EMAIL,
    displayName: "Dan Deigan",
    role: "superadmin",
    subscriptionStatus: "active",
    totalVectorizations: 0,
    createdAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  });

  console.log("✓ SuperAdmin record written to Firestore");
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  UID:      ${uid}`);
  console.log(`  Role:     superadmin`);
  process.exit(0);
} catch (err) {
  console.error("✗ Failed:", err.code, err.message);
  process.exit(1);
}
