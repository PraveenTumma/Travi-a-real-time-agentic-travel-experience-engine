/**
 * Firestore Service — all database operations for collaborative planning.
 *
 * Collections:
 *   users/{uid}           — user profiles (auto-created on login)
 *   friendRequests/{id}   — pending/accepted/rejected friend requests
 *   friends/{id}          — accepted friendships (bidirectional)
 *   sharedTrips/{id}      — collaboratively planned trips
 *   savedTrips/{id}       — user's saved itineraries
 */

import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

// ──────────────────────────────────────────────
// 1. USER PROFILES
// ──────────────────────────────────────────────

/**
 * Create or update the user profile in Firestore.
 * Called automatically on every login.
 */
export async function upsertUserProfile(user) {
  if (!user) return;
  const ref = doc(db, 'users', user.uid);
  await setDoc(ref, {
    displayName: user.displayName || '',
    email: user.email || '',
    photoURL: user.photoURL || '',
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

/**
 * Look up a user by their email address.
 * Returns the user doc data + uid, or null if not found.
 */
export async function findUserByEmail(email) {
  const q = query(collection(db, 'users'), where('email', '==', email.toLowerCase()));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { uid: docSnap.id, ...docSnap.data() };
}

// ──────────────────────────────────────────────
// 2. FRIEND REQUESTS
// ──────────────────────────────────────────────

/**
 * Send a friend request to another user by email.
 */
export async function sendFriendRequest(fromUser, toEmail) {
  const normalizedEmail = toEmail.trim().toLowerCase();

  // Don't let a user friend themselves
  if (normalizedEmail === fromUser.email.toLowerCase()) {
    throw new Error("You can't send a friend request to yourself!");
  }

  // Check if recipient exists
  const recipient = await findUserByEmail(normalizedEmail);

  // Check for existing pending request in either direction
  const existingQ = query(
    collection(db, 'friendRequests'),
    where('fromEmail', '==', fromUser.email.toLowerCase()),
    where('toEmail', '==', normalizedEmail),
    where('status', '==', 'pending'),
  );
  const existingSnap = await getDocs(existingQ);
  if (!existingSnap.empty) {
    throw new Error('You already have a pending request to this person.');
  }

  // Check if already friends
  const friendsQ = query(
    collection(db, 'friends'),
    where('userEmails', 'array-contains', fromUser.email.toLowerCase()),
  );
  const friendsSnap = await getDocs(friendsQ);
  const alreadyFriends = friendsSnap.docs.some(d =>
    d.data().userEmails.includes(normalizedEmail)
  );
  if (alreadyFriends) {
    throw new Error('You are already friends with this person!');
  }

  await addDoc(collection(db, 'friendRequests'), {
    fromUid: fromUser.uid,
    fromEmail: fromUser.email.toLowerCase(),
    fromName: fromUser.displayName || fromUser.email,
    fromPhoto: fromUser.photoURL || '',
    toEmail: normalizedEmail,
    toUid: recipient ? recipient.uid : '',
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}

/**
 * Subscribe to incoming friend requests for the current user (real-time).
 * Returns an unsubscribe function.
 */
export function subscribeToFriendRequests(userEmail, callback) {
  const q = query(
    collection(db, 'friendRequests'),
    where('toEmail', '==', userEmail.toLowerCase()),
    where('status', '==', 'pending'),
  );
  return onSnapshot(q, (snap) => {
    const requests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(requests);
  });
}

/**
 * Accept a friend request — creates a friendship doc and updates the request.
 */
export async function acceptFriendRequest(requestId, currentUser) {
  const reqRef = doc(db, 'friendRequests', requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error('Request not found.');

  const reqData = reqSnap.data();

  // Create the bidirectional friendship
  await addDoc(collection(db, 'friends'), {
    users: [reqData.fromUid, currentUser.uid],
    userEmails: [reqData.fromEmail, currentUser.email.toLowerCase()],
    userNames: [reqData.fromName, currentUser.displayName || currentUser.email],
    userPhotos: [reqData.fromPhoto || '', currentUser.photoURL || ''],
    createdAt: serverTimestamp(),
  });

  // Mark request as accepted
  await updateDoc(reqRef, { status: 'accepted', toUid: currentUser.uid });
}

/**
 * Reject a friend request.
 */
export async function rejectFriendRequest(requestId) {
  await updateDoc(doc(db, 'friendRequests', requestId), { status: 'rejected' });
}

// ──────────────────────────────────────────────
// 3. FRIENDS LIST
// ──────────────────────────────────────────────

/**
 * Subscribe to the current user's friends list (real-time).
 * Returns an unsubscribe function.
 */
export function subscribeToFriends(userEmail, callback) {
  const q = query(
    collection(db, 'friends'),
    where('userEmails', 'array-contains', userEmail.toLowerCase()),
  );
  return onSnapshot(q, (snap) => {
    const friends = snap.docs.map(d => {
      const data = d.data();
      // Find the *other* user's info
      const idx = data.userEmails.indexOf(userEmail.toLowerCase());
      const friendIdx = idx === 0 ? 1 : 0;
      return {
        id: d.id,
        uid: data.users[friendIdx],
        email: data.userEmails[friendIdx],
        displayName: data.userNames?.[friendIdx] || data.userEmails[friendIdx],
        photoURL: data.userPhotos?.[friendIdx] || '',
      };
    });
    callback(friends);
  });
}

// ──────────────────────────────────────────────
// 4. SHARED TRIPS
// ──────────────────────────────────────────────

/**
 * Create a shared trip from a generated itinerary and invite friends.
 */
export async function createSharedTrip(creatorUser, tripData, invitedFriendUids, invitedFriendEmails) {
  const allMembers = [creatorUser.uid, ...invitedFriendUids];
  const allEmails = [creatorUser.email.toLowerCase(), ...invitedFriendEmails.map(e => e.toLowerCase())];

  const docRef = await addDoc(collection(db, 'sharedTrips'), {
    createdBy: creatorUser.uid,
    creatorName: creatorUser.displayName || creatorUser.email,
    members: allMembers,
    memberEmails: allEmails,
    destination: tripData.destination || '',
    origin: tripData.origin || tripData.itinerary?.origin || '',
    originValue: tripData.originValue || '',
    startDate: tripData.startDate || '',
    endDate: tripData.endDate || '',
    itinerary: tripData.itinerary || null,
    status: 'planning',
    createdAt: serverTimestamp(),
  });

  return docRef.id;
}

/**
 * Subscribe to shared trips the current user is part of (real-time).
 */
export function subscribeToSharedTrips(userUid, callback) {
  const q = query(
    collection(db, 'sharedTrips'),
    where('members', 'array-contains', userUid),
  );
  return onSnapshot(q, (snap) => {
    const trips = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(trips);
  });
}

/**
 * Update a shared trip's itinerary (e.g. after a re-plan).
 */
export async function updateSharedTripItinerary(tripId, newItinerary) {
  await updateDoc(doc(db, 'sharedTrips', tripId), {
    itinerary: newItinerary,
    updatedAt: serverTimestamp(),
  });
}

// ──────────────────────────────────────────────
// 5. SAVED TRIPS (Personal History)
// ──────────────────────────────────────────────

/**
 * Save a generated itinerary to the user's personal trip history.
 */
export async function saveTrip(user, tripConfig, itineraryData) {
  const docRef = await addDoc(collection(db, 'savedTrips'), {
    uid: user.uid,
    userEmail: user.email.toLowerCase(),
    destination: tripConfig.destination || itineraryData.destination || '',
    origin: tripConfig.origin || itineraryData.origin || '',
    originValue: tripConfig.originValue || '',
    startDate: tripConfig.startDate || '',
    endDate: tripConfig.endDate || '',
    budgetLevel: tripConfig.budgetLevel || 'moderate',
    travelerType: tripConfig.travelerType || 'solo',
    preferences: tripConfig.preferences || [],
    itinerary: itineraryData,
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

/**
 * Subscribe to the current user's saved trips (real-time).
 * Returns an unsubscribe function.
 */
export function subscribeToSavedTrips(userUid, callback) {
  const q = query(
    collection(db, 'savedTrips'),
    where('uid', '==', userUid),
  );
  return onSnapshot(q, (snap) => {
    const trips = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Sort by createdAt descending (newest first)
    trips.sort((a, b) => {
      const aTime = a.createdAt?.seconds || 0;
      const bTime = b.createdAt?.seconds || 0;
      return bTime - aTime;
    });
    callback(trips);
  });
}

/**
 * Delete a saved trip from the user's history.
 */
export async function deleteSavedTrip(tripId) {
  await deleteDoc(doc(db, 'savedTrips', tripId));
}
