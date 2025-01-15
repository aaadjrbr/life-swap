import { db } from "./firebaseConfig.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  orderBy,
  addDoc,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  increment,
  arrayUnion,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const auth = getAuth();

// DOM elements
const ownedItemsDiv = document.getElementById("ownedItems");
const interestedItemsDiv = document.getElementById("interestedItems");
const chatContainer = document.getElementById("chatContainer");
const chatTitle = document.getElementById("chatTitle");
const messagesDiv = document.getElementById("messages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

// State variables
let currentUser = null;
let unsubChat = null;
let activeSwapId = null;
let chattingWithUserId = null;
let activeSwapTitle = null;

// Listen for auth state changes
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("Please log in first!");
    return;
  }
  currentUser = user;

  // Load owned and interested items
  await loadOwnedItems();
  await loadInterestedItems();

  // Check if the URL has a swapId parameter
  const params = new URLSearchParams(window.location.search);
  const paramSwapId = params.get("swapId");
  const paramSenderId = params.get("senderId");
  if (paramSwapId) {
    const swapRef = doc(db, "swaps", paramSwapId);
    const snap = await getDoc(swapRef);
    if (snap.exists()) {
      const swapData = snap.data();
      let otherUserId;
      if (swapData.userId === currentUser.uid) {
        otherUserId = paramSenderId;
      } else {
        otherUserId = swapData.userId;
      }
      openChat(paramSwapId, otherUserId, swapData.title || "Untitled");
    }
  }
});

/* Load items owned by the current user */
async function loadOwnedItems() {
  ownedItemsDiv.innerHTML = "Loading...";
  const qOwner = query(collection(db, "swaps"), where("userId", "==", currentUser.uid));
  const snap = await getDocs(qOwner);

  ownedItemsDiv.innerHTML = "";
  let foundAny = false;

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.interestedUsers.length > 0) {
      foundAny = true;
      ownedItemsDiv.appendChild(renderOwnedItem(docSnap.id, data));
    }
  });

  if (!foundAny) {
    ownedItemsDiv.innerHTML = "No users interested yet in your items.";
  }
}

/* Render an owned item card */
function renderOwnedItem(swapId, swapData) {
  const card = document.createElement("div");
  card.className = "item-card";
  card.innerHTML = `
    <h3>${swapData.title || "Untitled"}</h3>
    <p>${swapData.description || ""}</p>
    <p>Status: ${swapData.status}</p>
    <p>Interested Users: ${swapData.interestedUsers.length}</p>
  `;

  // Toggle interested users list
  card.addEventListener("click", async () => {
    let existing = card.querySelector(".interested-list");
    if (existing) {
      existing.remove();
      return;
    }
    const listDiv = document.createElement("div");
    listDiv.className = "interested-list";
    for (let uid of swapData.interestedUsers) {
      const userDiv = await createInterestedUserDiv(uid, swapId, swapData);
      listDiv.appendChild(userDiv);
    }
    card.appendChild(listDiv);
  });

  // Add buttons based on deal status
  if (swapData.status === "open") {
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close Deal";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeDeal(swapId, swapData.interestedUsers[0]);
    });
    card.appendChild(closeBtn);
  } else if (swapData.status === "closed") {
    const reopenBtn = document.createElement("button");
    reopenBtn.textContent = "Reopen Deal";
    reopenBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      reopenDeal(swapId);
    });
    card.appendChild(reopenBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete Deal";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteDeal(swapId);
    });
    card.appendChild(deleteBtn);
  }

  return card;
}

/* Create a div for an interested user */
async function createInterestedUserDiv(uid, swapId, swapData) {
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);
  let userName = uid;
  if (snap.exists()) {
    userName = snap.data().name || userName;
  }

  const container = document.createElement("div");
  container.className = "interested-user";
  container.innerHTML = `
    <strong>${userName}</strong>
    <button class="chatBtn">Chat</button>
  `;

  // Chat with this interested user
  container.querySelector(".chatBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    openChat(swapId, uid, swapData.title || "Untitled");
  });

  return container;
}

/* Load items the current user is interested in */
async function loadInterestedItems() {
  interestedItemsDiv.innerHTML = "Loading...";
  const qInt = query(collection(db, "swaps"), where("interestedUsers", "array-contains", currentUser.uid));
  const snap = await getDocs(qInt);

  interestedItemsDiv.innerHTML = "";
  let foundAny = false;

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.userId !== currentUser.uid) {
      foundAny = true;
      interestedItemsDiv.appendChild(renderInterestedItem(docSnap.id, data));
    }
  });

  if (!foundAny) {
    interestedItemsDiv.innerHTML = "No items you are interested in.";
  }
}

/* Render an interested item card */
function renderInterestedItem(swapId, swapData) {
  const card = document.createElement("div");
  card.className = "item-card";
  card.innerHTML = `
    <h3>${swapData.title || "Untitled"}</h3>
    <p>${swapData.description || ""}</p>
    <p>Status: ${swapData.status}</p>
  `;

  // Open chat with the owner
  card.addEventListener("click", () => {
    openChat(swapId, swapData.userId, swapData.title || "Untitled");
  });

  return card;
}

/* Open a chat with the other user */
async function openChat(swapId, otherUserId, swapTitle) {
    if (unsubChat) unsubChat();
    messagesDiv.innerHTML = "";
    chatContainer.style.display = "block";
    activeSwapId = swapId;
    chattingWithUserId = otherUserId;
    activeSwapTitle = swapTitle;
  
    chatTitle.textContent = `Chat about: ${swapTitle}`;
  
    const swapRef = doc(db, "swaps", swapId);
    const swapSnap = await getDoc(swapRef);
    if (!swapSnap.exists()) return;
    const swapData = swapSnap.data();
  
    if (swapData.status === "pending" && swapData.interestedUsers.includes(currentUser.uid)) {
      promptUserToRate(swapId, swapData.userId);
    }
  
    const msgColl = collection(db, "swaps", swapId, "messages");
    const qMsgs = query(msgColl, orderBy("createdAt", "asc"));
    unsubChat = onSnapshot(qMsgs, async (snapshot) => {
      messagesDiv.innerHTML = "";
      for (const docSnap of snapshot.docs) {
        const msg = docSnap.data();
        const senderName = await getUserName(msg.senderId);
        const time = msg.createdAt?.toDate()?.toLocaleString() || "";
        const msgEl = document.createElement("div");
        msgEl.style.margin = "0.2rem 0";
        msgEl.innerHTML = `<strong>${senderName}</strong> [${time}]: ${msg.text}`;
        messagesDiv.appendChild(msgEl);
  
        // Mark as read
        if (!msg.readBy?.includes(currentUser.uid)) {
          await updateDoc(docSnap.ref, {
            readBy: [...(msg.readBy || []), currentUser.uid]
          });
        }
      }
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
      // Call to check deal interactions after updating chat
      updateDealInteraction();
    });
}

/* Get a user's name by UID */
async function getUserName(uid) {
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);
  return snap.exists() ? snap.data().name || uid : uid;
}

/* Send a message in the chat */
sendBtn.addEventListener("click", async () => {
  if (!activeSwapId || !chatInput.value.trim()) return;
  const text = chatInput.value.trim();
  chatInput.value = "";

  const msgRef = collection(db, "swaps", activeSwapId, "messages");
  await addDoc(msgRef, {
    text,
    senderId: currentUser.uid,
    createdAt: serverTimestamp(),
    readBy: [currentUser.uid],
  });
});

/* Close a deal and prompt for ratings */
async function closeDeal(swapId, otherUserId) {
  const ratingOwner = prompt("Rate the interested user from 0 to 100", "100");
  if (ratingOwner === null) return;
  const rating = parseInt(ratingOwner, 10);
  if (isNaN(rating) || rating < 0 || rating > 100) return;

  try {
    // Store the owner's rating
    await storeRating(currentUser.uid, otherUserId, swapId, rating);

    // Update swap status to "pending"
    const swapRef = doc(db, "swaps", swapId);
    await updateDoc(swapRef, { status: "pending" });

    alert("Deal is pending. The other user will be prompted to rate you.");
    loadOwnedItems();
  } catch (err) {
    console.error("Error closing deal:", err);
    alert("Failed to close deal.");
  }
}

/* Store a rating in the ratings collection */
async function storeRating(raterUid, rateeUid, swapId, rating) {
    const ratingsRef = collection(db, "ratings");
    await addDoc(ratingsRef, {
      raterUid,
      rateeUid,
      swapId,
      rating,
    });
  
    // Update ratee's reputation and closed swaps count
    const rateeRatingsQuery = query(collection(db, "ratings"), where("rateeUid", "==", rateeUid));
    const rateeRatingsSnap = await getDocs(rateeRatingsQuery);
    const totalRatings = rateeRatingsSnap.docs.length;
    let sumRatings = 0;
    rateeRatingsSnap.docs.forEach(doc => {
      sumRatings += doc.data().rating;
    });
    const newReputation = totalRatings > 0 ? (sumRatings / totalRatings) : 0;
  
    // Update ratee's user document
    const rateeUserRef = doc(db, "users", rateeUid);
    await updateDoc(rateeUserRef, {
      reputation: newReputation,
      closedSwaps: increment(1),
    });
  }

/* Reopen a deal */
async function reopenDeal(swapId) {
  if (!confirm("Are you sure you want to reopen this deal?")) return;

  try {
    const swapRef = doc(db, "swaps", swapId);
    await updateDoc(swapRef, { status: "open" });

    // Remove associated ratings
    const ratingsRef = collection(db, "ratings");
    const q = query(ratingsRef, where("swapId", "==", swapId));
    const ratingsSnap = await getDocs(q);
    ratingsSnap.forEach(async (doc) => {
      await deleteDoc(doc.ref);
    });

    alert("Deal reopened.");
    loadOwnedItems();
  } catch (err) {
    console.error("Error reopening deal:", err);
    alert("Failed to reopen deal.");
  }
}

/* Delete a deal */
async function deleteDeal(swapId) {
  if (!confirm("Are you sure you want to delete this deal?")) return;

  try {
    const swapRef = doc(db, "swaps", swapId);
    await deleteDoc(swapRef);

    // Remove associated ratings
    const ratingsRef = collection(db, "ratings");
    const q = query(ratingsRef, where("swapId", "==", swapId));
    const ratingsSnap = await getDocs(q);
    ratingsSnap.forEach(async (doc) => {
      await deleteDoc(doc.ref);
    });

    alert("Deal deleted.");
    loadOwnedItems();
  } catch (err) {
    console.error("Error deleting deal:", err);
    alert("Failed to delete deal.");
  }
}

/* Prompt the interested user to rate the owner */
async function promptUserToRate(swapId, ownerUserId) {
    const rating = prompt("Please rate the owner from 0 to 100", "100");
    if (rating === null) return;
    const ratingValue = parseInt(rating, 10);
    if (isNaN(ratingValue) || ratingValue < 0 || ratingValue > 100) {
      alert("Invalid rating. Please enter a number between 0 and 100.");
      return;
    }
    
    try {
      // Store the interested user's rating
      await storeRating(currentUser.uid, ownerUserId, swapId, ratingValue);
      
      // Update swap status to "closed"
      const swapRef = doc(db, "swaps", swapId);
      await updateDoc(swapRef, { status: "closed" });
      
      alert("Thank you for your rating! The deal is now closed.");
      loadInterestedItems();
    } catch (err) {
      console.error("Error rating owner:", err);
      alert("Failed to submit your rating.");
    }
  }
  