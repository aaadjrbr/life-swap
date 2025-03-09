import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, setDoc, doc, getDoc, updateDoc, addDoc, collection, query, where, getDocs, limit, deleteDoc, limitToLast, startAfter, endBefore, orderBy, enableIndexedDbPersistence, runTransaction, writeBatch, deleteField } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { toggleComments } from './commentsReplies.js'; // Import the function too

const firebaseConfig = {
  apiKey: "AIzaSyB5Q0kHoViWJl-t-pWCKj_AT-ClAMadfrU",
  authDomain: "life-swap-6065e.firebaseapp.com",
  projectId: "life-swap-6065e",
  storageBucket: "life-swap-6065e.firebasestorage.app",
  messagingSenderId: "475311181000",
  appId: "1:475311181000:web:32d03d80f70081bfb629fd",
  measurementId: "G-CHJY2ZEYYF"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// Enable offline persistence
enableIndexedDbPersistence(db)
.then(() => {
console.log("Offline persistence enabled successfully!");
})
.catch((err) => {
if (err.code === "failed-precondition") {
  console.warn("Persistence failed: Multiple tabs open. Only one tab can enable persistence.");
} else if (err.code === "unimplemented") {
  console.warn("Persistence not available: Browser doesn’t support it.");
} else {
  console.error("Persistence error:", err);
}
});

export let communityId; // At the top
let userDataCache = {};

// Cache control settings for user data
const USER_CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds
const USER_CACHE_MAX_SIZE = 100; // Max 100 entries

// Cache helper functions
function getCachedUser(key) {
const entry = userDataCache[key];
if (!entry) return null;
if (Date.now() > entry.expiry) {
delete userDataCache[key];
console.log(`Cache expired for ${key}`);
return null;
}
return entry.value;
}

function setCachedUser(key, value) {
if (Object.keys(userDataCache).length >= USER_CACHE_MAX_SIZE) {
const oldestKey = Object.keys(userDataCache)[0]; // FIFO: first added
delete userDataCache[oldestKey];
console.log(`Cache size limit hit, removed ${oldestKey}`);
}
userDataCache[key] = { value, expiry: Date.now() + USER_CACHE_TTL };
console.log(`Cached ${key}, expires at ${new Date(Date.now() + USER_CACHE_TTL)}`);
}
let currentPage = 1;
export const postsPerPage = 10;
let lastMemberDoc = null;
export let carouselPostIds = []; // Store post IDs for navigation
let carouselIndex = 0; // Current start index
export const postsPerCarousel = window.innerWidth < 768 ? 2 : 4; // 2 on mobile, 4 on desktop
export let isLoading = false;
let lastPostDoc = null;
let totalPosts = 0;
export const postsPerLoad = 10; // 10 posts per scroll
let loadedPostIds = new Set();
let initialPostsLoaded = false;
let isSearching = false; // Flag to track if we're in search mode
let postCache = new Map(); // Add this near your other globals (e.g., after userDataCache)
export const POSTS_PER_LOAD = 20; // Bigger batch size
let isFetching = false; 
let allNotifications = [];
let lastDoc = null;
let displayedCount = 0;

const categoryDisplayMap = {
"clothing_accessories": "Clothing & Accessories",
"electronics": "Electronics & Gadgets",
"furniture_decor": "Furniture & Home Decor",
"kitchen_dining": "Kitchen & Dining",
"tools_diy": "Tools & DIY",
"books_media": "Books, Movies & Music",
"arts_crafts": "Arts & Crafts",
"toys_games": "Toys & Games",
"sports_outdoors": "Sports & Outdoors",
"health_beauty": "Health & Beauty",
"baby_kids": "Baby & Kids",
"pet_supplies": "Pet Supplies",
"misc": "Miscellaneous"
};

document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      console.log("No user detected, redirecting to login...");
      window.location.href = "/login.html";
      return;
    }

    console.log("User authenticated:", user.uid);

    const urlParams = new URLSearchParams(window.location.search);
    communityId = urlParams.get("id");
    window.communityId = communityId; // Expose globally
    if (!communityId) {
      console.log("No community ID, redirecting to index...");
      window.location.href = "/index.html";
      return;
    }

    // Clear caches for new community
    postCache.clear();
    loadedPostIds.clear();
    console.log(`Cleared post caches for community ${communityId}`);

    await initializeUserSwapInfo();

    const commData = await getCommData();
    if (!commData) {
      alert("Community not found!");
      window.location.href = "/index.html";
      return;
    }

    const isMember = commData.members.includes(user.uid);
    const bannedUsers = commData.bannedUsers || [];
    const banStatus = commData.banStatus || {};
    const isBanned = bannedUsers.includes(user.uid) && (banStatus[user.uid] === "active" || !banStatus[user.uid]); // Updated to check banStatus

    if (isBanned) {
      let adminEmail = "No admin email available";
      let banReason = commData.banReasons?.[user.uid] || "No reason provided";

      // Fetch admin email (creator first, then first admin if no creator email)
      if (commData.creatorId) {
        const creatorDoc = await getDoc(doc(db, "users", commData.creatorId));
        if (creatorDoc.exists() && creatorDoc.data().email) {
          adminEmail = creatorDoc.data().email;
        }
      }
      if (adminEmail === "No admin email available" && commData.admins?.length > 0) {
        const adminDoc = await getDoc(doc(db, "users", commData.admins[0]));
        if (adminDoc.exists() && adminDoc.data().email) {
          adminEmail = adminDoc.data().email;
        }
      }

      // Check if ban was reinstated (active but no banReason means it’s a reinstatement)
      if (banStatus[user.uid] === "active" && !commData.banReasons?.[user.uid]) {
        banReason = `An administrator has reinstated your ban. For the original or a diffrent reason. Please contact us at ${adminEmail} or submit an appeal below.`;
      }

      document.querySelector(".community-page").innerHTML = `
        <div class="ban-message">
          <h2>You are banned from this community!</h2>
          <p><strong>Reason:</strong> ${banReason}</p>
          <p>Think this is a mistake? Send an appeal below or contact an admin at: ${adminEmail}</p>
          <form id="banAppealForm" class="ban-appeal-form">
            <textarea placeholder="Explain why this ban might be an error..." required></textarea>
            <button type="submit">Send Appeal</button>
          </form>
          <p><a href="./start.html">Go back</a></p>
        </div>
      `;
      const appealForm = document.getElementById("banAppealForm");
      appealForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = appealForm.querySelector("textarea").value.trim();
        if (text) {
          const userDoc = await getDoc(doc(db, "users", user.uid));
          const userData = userDoc.exists() ? userDoc.data() : { username: `user_${user.uid.slice(0, 8)}` };

          await addDoc(collection(db, "communities", communityId, "banAppeals"), {
            userId: user.uid,
            username: userData.username,
            message: text,
            timestamp: new Date()
          });
          alert("Appeal sent!");
          appealForm.querySelector("textarea").disabled = true;
          appealForm.querySelector("button").disabled = true;
          appealForm.querySelector("button").textContent = "Appeal Sent";
        }
      });
      return;
    } else if (!isMember) {
      document.querySelector(".community-page").innerHTML = `
        <div class="not-member-message">
          <h2>You aren't a member of this community.</h2>
          <p>Copy the community ID and go back to join! We are waiting for you! 💚</p>
          <p><strong>Community ID:</strong> <span id="communityIdText">${communityId}</span> 
             <a href="./start.html" id="copyAndJoinLink">Copy ID and Join</a></p>
          <p><a href="./start.html">Go back</a></p>
        </div>
      `;
      
      document.getElementById("copyAndJoinLink").addEventListener("click", (e) => {
        e.preventDefault();
        navigator.clipboard.writeText(communityId)
          .then(() => {
            alert("Community ID copied to clipboard! Head back to join.");
            setTimeout(() => {
              window.location.href = "./start.html";
            }, 500);
          })
          .catch((err) => {
            console.error("Failed to copy community ID:", err);
            alert("Failed to copy ID. Please copy it manually: " + communityId);
          });
      });
      return;
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        console.log("User is back on screen, resuming checks.");
        updateNotificationBadge(user.uid);
        updateChatBadge(user.uid);
      } else {
        console.log("User is away from screen, stopping updates.");
      }
    });

    document.getElementById("communityName").textContent = commData.name;
    const createdAt = commData.createdAt 
      ? new Date(commData.createdAt.toDate()).toLocaleString('en-US', { 
          month: 'long', 
          day: 'numeric', 
          year: 'numeric' 
        }) 
      : "N/A";
    document.getElementById("createdAt").textContent = createdAt;
    const creatorData = await fetchUserData(commData.creatorId);
    document.getElementById("creatorName").textContent = creatorData.name || "Unknown";
    document.getElementById("creatorName").addEventListener("click", () => viewProfile(commData.creatorId));

    document.getElementById("communityId").textContent = `ID: ${communityId}`;
    document.getElementById("totalUsers").textContent = commData.memberCount || commData.members.length;
    document.getElementById("bannedUsers").textContent = (commData.bannedUsers || []).length;

    const actions = document.getElementById("communityActions");
    let profileViewRequestCount = 0;
    if (user.uid) {
      const profileViewRequestsQ = query(
        collection(db, "profileRequests"),
        where("targetId", "==", user.uid),
        where("status", "==", "pending")
      );
      try {
        const profileViewRequestsSnapshot = await getDocs(profileViewRequestsQ);
        profileViewRequestCount = profileViewRequestsSnapshot.size;
      } catch (error) {
        console.error("Failed to fetch profile view requests:", error);
      }
    } else {
      console.error("User UID is undefined, skipping profile requests query!");
    }

    actions.innerHTML = `
      ${commData.creatorId === user.uid ? `<button class="delete-btn" id="deleteCommunityBtn">Delete (Community)</button>` : ""}
      ${commData.members.includes(user.uid) && commData.creatorId !== user.uid ? `<button class="leave-btn" id="leaveCommunityBtn">Leave Community</button>` : ""}
      ${(commData.admins && commData.admins.includes(user.uid)) || commData.creatorId === user.uid ? `<button id="editNameBtn">Edit Name (Community)</button>` : ""}
      <br><br>
      <button id="viewMembersBtn">Members</button>
      ${(commData.admins && commData.admins.includes(user.uid)) || commData.creatorId === user.uid ? `<button id="viewBannedBtn">Banned</button>` : ""}
      <button id="viewProfileViewRequestsBtn">Profile Requests ${profileViewRequestCount > 0 ? `<span class="request-badge">${profileViewRequestCount}</span>` : ''}</button>
      <button id="viewSavedPostsBtn">Saved Posts</button>
      <button id="viewChatsBtn">💬 Chats</button>
      <button id="viewMyFollowersBtn">Followers</button>
    `;

    await new Promise(resolve => setTimeout(resolve, 0));
    if (user.uid) {
      await updateProfileRequestsUI(user.uid);
    } else {
      console.error("Skipping updateProfileRequestsUI due to undefined UID");
    }

    const postIdSearch = document.getElementById("postSearch");
    const categoryFilter = document.getElementById("categoryFilter");
    const lookingForFilter = document.getElementById("lookingForFilter");
    const offeringFilter = document.getElementById("offeringFilter");
    const carouselPrevBtn = document.getElementById("carouselPrevBtn");
    const carouselNextBtn = document.getElementById("carouselNextBtn");
    const copyCommunityIdBtn = document.getElementById("copyCommunityIdBtn");
    const createPostBtn = document.getElementById("createPostBtn");
    const viewMembersBtn = document.getElementById("viewMembersBtn");
    const viewBannedBtn = document.getElementById("viewBannedBtn");
    const deleteCommunityBtn = document.getElementById("deleteCommunityBtn");
    const leaveCommunityBtn = document.getElementById("leaveCommunityBtn");
    const viewProfileViewRequestsBtn = document.getElementById("viewProfileViewRequestsBtn");
    const closeProfileBtn = document.getElementById("closeProfileBtn");
    const closeMembersBtn = document.getElementById("closeMembersBtn");
    const closeBannedBtn = document.getElementById("closeBannedBtn");
    const closeProfileViewRequestsBtn = document.getElementById("closeProfileViewRequestsBtn");
    const viewNotificationsBtn = document.getElementById("viewNotificationsBtn");
    const closeNotificationsBtn = document.getElementById("closeNotificationsBtn");
    const clearNotificationsBtn = document.getElementById("clearNotificationsBtn");
    const refreshPostsBtn = document.getElementById("refreshPostsBtn");
    const editNameBtn = document.getElementById("editNameBtn");
    const viewCommunitiesBtn = document.getElementById("viewCommunitiesBtn");
    const viewSavedPostsBtn = document.getElementById("viewSavedPostsBtn");
    const viewChatsBtn = document.getElementById("viewChatsBtn");
    const postSearchInput = document.getElementById("postSearch");
    const pasteSearchBtn = document.getElementById("pasteSearchBtn");
    const clearSearchBtn = document.getElementById("clearSearchBtn");
    const viewMyFollowersBtn = document.getElementById("viewMyFollowersBtn");

    if (postIdSearch) {
      postIdSearch.addEventListener("input", debounce((e) => {
        searchPostsById(e.target.value);
      }, 300));
    }
    pasteSearchBtn.addEventListener("click", async () => {
      try {
        const clipboardText = await navigator.clipboard.readText();
        postSearchInput.value = clipboardText;
        searchPostsById(clipboardText);
      } catch (error) {
        console.error("Paste failed:", error);
        alert("Couldn’t paste—check clipboard permissions!");
      }
    });

    clearSearchBtn.addEventListener("click", () => {
      postSearchInput.value = "";
      searchPostsById("");
    });
    if (categoryFilter) {
      categoryFilter.addEventListener("change", () => {
        loadPosts(communityId, true);
        carouselIndex = 0;
        loadCarouselPosts(communityId);
      });
    }
    if (lookingForFilter) {
      lookingForFilter.addEventListener("change", () => {
        loadPosts(communityId, true);
        carouselIndex = 0;
        loadCarouselPosts(communityId);
      });
    }
    if (offeringFilter) {
      offeringFilter.addEventListener("change", () => {
        loadPosts(communityId, true);
        carouselIndex = 0;
        loadCarouselPosts(communityId);
      });
    }
    if (carouselPrevBtn) carouselPrevBtn.addEventListener("click", () => slideCarousel(-1));
    if (carouselNextBtn) carouselNextBtn.addEventListener("click", () => slideCarousel(1));
    if (copyCommunityIdBtn) copyCommunityIdBtn.addEventListener("click", copyCommunityId);
    if (createPostBtn) createPostBtn.addEventListener("click", createPost);
    if (viewMembersBtn) viewMembersBtn.addEventListener("click", () => viewMembers(communityId));
    if (viewBannedBtn) viewBannedBtn.addEventListener("click", () => viewBannedUsers(communityId));
    if (deleteCommunityBtn) deleteCommunityBtn.addEventListener("click", () => deleteCommunity(communityId));
    if (leaveCommunityBtn) leaveCommunityBtn.addEventListener("click", () => leaveCommunity(communityId));
    if (viewProfileViewRequestsBtn) viewProfileViewRequestsBtn.addEventListener("click", () => viewProfileViewRequests(user.uid));
    if (closeProfileBtn) closeProfileBtn.addEventListener("click", () => closeModal("viewProfileModal"));
    if (closeMembersBtn) closeMembersBtn.addEventListener("click", () => closeModal("viewMembersModal"));
    if (closeBannedBtn) closeBannedBtn.addEventListener("click", () => closeModal("viewBannedModal"));
    if (closeProfileViewRequestsBtn) closeProfileViewRequestsBtn.addEventListener("click", () => closeModal("viewProfileViewRequestsModal"));
    if (viewNotificationsBtn) viewNotificationsBtn.addEventListener("click", () => openNotificationsModal(user.uid));
    if (closeNotificationsBtn) closeNotificationsBtn.addEventListener("click", () => closeModal("notificationsModal"));
    if (clearNotificationsBtn) clearNotificationsBtn.addEventListener("click", clearNotifications);
    if (refreshPostsBtn) refreshPostsBtn.addEventListener("click", () => loadPosts(communityId, true));
    if (editNameBtn) editNameBtn.addEventListener("click", () => editCommunityName(communityId));
    if (viewCommunitiesBtn) viewCommunitiesBtn.addEventListener("click", () => viewCommunities(user.uid));
    if (viewSavedPostsBtn) viewSavedPostsBtn.addEventListener("click", () => viewSavedPosts(user.uid));
    if (viewChatsBtn) {
      viewChatsBtn.removeEventListener("click", handleViewChatsClick);
      viewChatsBtn.addEventListener("click", handleViewChatsClick);
    }
    if (viewMyFollowersBtn) {
      viewMyFollowersBtn.addEventListener("click", () => viewFollowers(user.uid));
    }   

    async function handleViewChatsClick() {
      await updateChatBadge(user.uid, true);
      await window.viewChats(communityId);
      await updateChatBadge(user.uid);
    }

    setupLocationAutocomplete();
    setupCommunitySelection();
    loadYourPosts(user.uid);
    loadPosts(communityId, false);
    loadCarouselPosts(communityId);
    updateNotificationBadge(user.uid);
    await updateChatBadge(user.uid);
    await loadAdminReportSummary(user.uid);
  });
});

async function initializeUserSwapInfo() {
const user = auth.currentUser;
if (!user) return;

if (!communityId) {
console.error("communityId is undefined, cannot initialize user swap info");
return; // Exit early if communityId isn’t set
}

const userRef = doc(db, "users", user.uid);
let userDoc = await getDoc(userRef);
let userData;

console.log(`Fetching user data for UID: ${user.uid}`);

// If user doesn't exist in Firestore, create a new entry
if (!userDoc.exists()) {
userData = {
  name: user.displayName || "Unnamed User",
  username: `user_${user.uid.slice(0, 8)}`, // Simple unique username
  profilePhoto: user.photoURL || null,
  email: user.email || null,
  city: null,
  phone: null,
  communityIds: [communityId], // Add current community
  swaps: 0, // Initialize swaps to 0
  createdAt: new Date()
};
console.log("Creating new user with data:", userData);
await setDoc(userRef, userData); // Create the user document
console.log(`Created new user in DB: ${userData.username}`);
} else {
userData = userDoc.data();
console.log("Existing user data:", userData);

// Ensure swaps field exists
if (typeof userData.swaps === "undefined") {
  console.log("Swaps field undefined, setting to 0");
  await updateDoc(userRef, { swaps: 0 });
  userData.swaps = 0;
}

// Ensure communityIds exists and is an array
if (!Array.isArray(userData.communityIds)) {
  console.log("communityIds is not an array or undefined, initializing as []");
  userData.communityIds = [];
  await updateDoc(userRef, { communityIds: userData.communityIds });
}

// Add communityId if not already present
if (!userData.communityIds.includes(communityId)) {
  console.log(`Adding communityId ${communityId} to communityIds`);
  userData.communityIds.push(communityId);
  try {
    console.log("Updating communityIds with:", userData.communityIds);
    await updateDoc(userRef, { communityIds: userData.communityIds });
  } catch (error) {
    console.error("Error updating communityIds:", error);
    console.log("Current userData state:", userData);
    throw error;
  }
}
}

// Update the UI
const userNameSpan = document.getElementById("userNameCopy");
const swapCountSpan = document.getElementById("swapCount");

if (!userData.username) {
console.error("Username is undefined, falling back to UID-based default");
userData.username = `user_${user.uid.slice(0, 8)}`;
await updateDoc(userRef, { username: userData.username });
}

userNameSpan.textContent = userData.username;
swapCountSpan.textContent = userData.swaps;

// Add click-to-copy functionality
userNameSpan.addEventListener("click", () => {
navigator.clipboard.writeText(userData.username)
  .then(() => alert("Username copied to clipboard!"))
  .catch(err => console.error("Failed to copy username:", err));
});
}

async function updateChatBadge(userId, clearUnread = false) {
const chatIdsQ = query(
collection(db, "users", userId, "chatIds"),
where("hasUnread", "==", true)
);
const snapshot = await getDocs(chatIdsQ);
const viewChatsBtn = document.getElementById("viewChatsBtn");

if (clearUnread && snapshot.size > 0) {
const batch = writeBatch(db);
snapshot.docs.forEach((doc) => {
  batch.update(doc.ref, { hasUnread: false });
});
await batch.commit();
console.log("Cleared unread flags for chats:", snapshot.size);
}

const hasUnreadChats = clearUnread ? false : snapshot.size > 0;
if (viewChatsBtn) {
viewChatsBtn.innerHTML = `💬 Chats ${hasUnreadChats ? '<span class="chat-badge">(new)</span>' : ''}`;
}
}

async function updateProfileRequestsUI(userId) {
const requestsRef = collection(db, "users", userId, "profileRequests");
const requestsQ = query(requestsRef, where("status", "==", "pending"));
const requestsSnapshot = await getDocs(requestsQ);
const requestCount = requestsSnapshot.size;
const profileRequestsBtn = document.getElementById("profileRequestsBtn");
if (profileRequestsBtn) {
profileRequestsBtn.innerHTML = requestCount > 0 ? `<button id="viewRequestsBtn">Profile Requests (${requestCount})</button>` : "";
} else {
console.error("profileRequestsBtn not found in DOM");
}
if (document.getElementById("viewRequestsBtn")) {
document.getElementById("viewRequestsBtn").addEventListener("click", () => viewProfileViewRequests(userId));
}
const actions = document.getElementById("communityActions");
if (actions) {
const profileViewRequestsQ = query(requestsRef, where("status", "==", "pending"));
const profileViewRequestsSnapshot = await getDocs(profileViewRequestsQ);
const profileViewRequestCount = profileViewRequestsSnapshot.size;
const viewProfileViewRequestsBtn = actions.querySelector("#viewProfileViewRequestsBtn");
if (viewProfileViewRequestsBtn) {
  viewProfileViewRequestsBtn.innerHTML = `Profile Requests ${profileViewRequestCount > 0 ? `<span class="request-badge">${profileViewRequestCount}</span>` : ''}`;
}
}
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  modal.classList.add("hidden");
  modal.style.display = "none";
  const lowerModals = Array.from(document.querySelectorAll(".modal:not(.hidden)"));
  if (lowerModals.length > 0) lowerModals[lowerModals.length - 1].style.display = "flex";
  document.querySelectorAll(".suggestions").forEach(div => div.classList.add("hidden"));
}

function copyCommunityId() {
  navigator.clipboard.writeText(communityId).then(() => alert("Community ID copied!")).catch(err => console.error("Failed to copy:", err));
}

function copyPostId(postId) {
  navigator.clipboard.writeText(postId).then(() => alert("Post ID copied!")).catch(err => console.error("Failed to copy:", err));
}

async function deleteCommunity(communityId) {
  if (!confirm("Are you sure you want to delete this community? This action is permanent and cannot be undone.")) {
    return;
  }

  const communityRef = doc(db, "communities", communityId);
  const subcollections = ["members", "posts", "banAppeals", "postReports"];
  const statusElement = document.getElementById("delete-status");
  const bodyElement = document.body;
  const maxRetries = 5;
  let retryCount = 0;

  function updateStatus(message, state = "in-progress") {
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.className = `delete-status ${state === "in-progress" ? "deleting" : state}`;
      statusElement.style.display = "block"; // Ensure it’s visible
    }
    if (state === "in-progress") {
      bodyElement.classList.add("deleting"); // Add overlay
    } else {
      bodyElement.classList.remove("deleting"); // Remove overlay
    }
    console.log(`[DeleteCommunity] ${message}`);
  }

  updateStatus("Initiating community deletion process... Please wait.", "in-progress");

  try {
    console.log("[DeleteCommunity] Firestore instance:", db.toString());
    console.log("[DeleteCommunity] Community reference path:", communityRef.path);

    // Verify initial state
    const initialDoc = await getDoc(communityRef);
    console.log("[DeleteCommunity] Pre-deletion check - Document exists:", initialDoc.exists());
    if (initialDoc.exists()) {
      console.log("[DeleteCommunity] Pre-deletion document data:", initialDoc.data());
    } else {
      updateStatus("Community does not exist. Deletion unnecessary.", "success");
      return;
    }

    // Core deletion logic in a transaction
    async function executeDeletion() {
      const deletionStartTime = Date.now();
      console.log("[DeleteCommunity] Executing deletion transaction at:", new Date().toISOString());

      await runTransaction(db, async (transaction) => {
        const communityDoc = await transaction.get(communityRef);
        if (!communityDoc.exists()) {
          console.log("[DeleteCommunity] Document not found during transaction - skipping.");
          return;
        }

        // Delete all subcollections
        for (const subcollectionName of subcollections) {
          console.log(`[DeleteCommunity] Processing subcollection: ${subcollectionName}`);
          const subcollectionRef = collection(communityRef, subcollectionName);
          const subcollectionSnapshot = await getDocs(subcollectionRef);
          console.log(`[DeleteCommunity] ${subcollectionName} contains ${subcollectionSnapshot.size} documents`);
          subcollectionSnapshot.forEach((docSnapshot) => {
            transaction.delete(docSnapshot.ref);
          });
          console.log(`[DeleteCommunity] Queued ${subcollectionSnapshot.size} documents in ${subcollectionName} for deletion`);
        }

        // Delete the main community document
        transaction.delete(communityRef);
        console.log("[DeleteCommunity] Main community document queued for deletion");
      });

      console.log("[DeleteCommunity] Transaction completed in:", (Date.now() - deletionStartTime) / 1000, "seconds");
    }

    // Perform the deletion
    updateStatus("Deleting community data...");
    await executeDeletion();

    // Verify deletion with retries
    while (retryCount < maxRetries) {
      const postDeletionCheck = await getDoc(communityRef);
      console.log(`[DeleteCommunity] Verification ${retryCount + 1} - Post-deletion check - Exists:`, postDeletionCheck.exists());
      if (!postDeletionCheck.exists()) {
        console.log("[DeleteCommunity] Document successfully removed - verifying persistence...");
      } else {
        console.log("[DeleteCommunity] Document still present:", postDeletionCheck.data());
      }

      // Wait and recheck
      await new Promise(resolve => setTimeout(resolve, 2000));
      const finalVerification = await getDoc(communityRef);
      console.log(`[DeleteCommunity] Verification ${retryCount + 1} - After 2s delay - Exists:`, finalVerification.exists());

      if (!finalVerification.exists()) {
        console.log("[DeleteCommunity] Deletion confirmed - Document permanently removed.");
        break;
      } else {
        console.error("[DeleteCommunity] Document reappeared with data:", finalVerification.data());
        retryCount++;
        updateStatus(`Deletion incomplete - Retrying (${retryCount}/${maxRetries})...`);
        console.log(`[DeleteCommunity] Retry ${retryCount} initiated at:`, new Date().toISOString());
        await executeDeletion();
      }
    }

    if (retryCount >= maxRetries) {
      throw new Error("Unable to delete community - Document persists after maximum retries.");
    }

    // Final cleanup
    resetCommDataCache();
    console.log("[DeleteCommunity] Local cache cleared.");

    updateStatus(`Community ${communityId} successfully deleted. Redirecting...`, "success");
    setTimeout(() => {
      window.location.href = "./start.html";
    }, 2000);

  } catch (error) {
    console.error("[DeleteCommunity] Deletion process failed:", error);
    updateStatus(`Error: ${error.message}`, "error");
    alert("Community deletion failed. Please review the console for details.");
  }
}

async function leaveCommunity(communityId) {
  if (!confirm("Are you sure you want to leave this community?")) {
    return;
  }

  const user = auth.currentUser;
  if (!user) {
    console.error("No authenticated user!");
    alert("You must be logged in to leave a community.");
    return;
  }

  const userRef = doc(db, "users", user.uid);
  const memberRef = doc(db, "communities", communityId, "members", user.uid);

  try {
    // Start a batch to ensure atomic updates
    const batch = writeBatch(db);

    // Step 1: Remove the user from the community's members subcollection
    batch.delete(memberRef);
    console.log(`Queued deletion of member ${user.uid} from community ${communityId}`);

    // Step 2: Update the user's communityIds array
    const userDoc = await getDoc(userRef);
    if (!userDoc.exists()) {
      throw new Error("User document not found in Firestore");
    }

    const userData = userDoc.data();
    let currentCommunityIds = userData.communityIds || [];
    console.log("Current communityIds before leaving:", currentCommunityIds);

    // Filter out the communityId to leave
    const updatedCommunityIds = currentCommunityIds.filter(id => id !== communityId);
    if (currentCommunityIds.length === updatedCommunityIds.length) {
      console.warn(`Community ID ${communityId} not found in user's communityIds array`);
    } else {
      console.log("Updated communityIds after leaving:", updatedCommunityIds);
      batch.update(userRef, { communityIds: updatedCommunityIds });
    }

    // Commit the batch
    await batch.commit();
    console.log(`Successfully left community ${communityId}. Updated communityIds:`, updatedCommunityIds);

    // Verify the update in Firestore
    const updatedUserDoc = await getDoc(userRef);
    const verifiedCommunityIds = updatedUserDoc.data().communityIds || [];
    console.log("Verified communityIds in Firestore after update:", verifiedCommunityIds);

    if (!verifiedCommunityIds.includes(communityId)) {
      console.log(`Confirmed: Community ID ${communityId} removed from user's communityIds`);
    } else {
      console.error(`Failed to remove community ID ${communityId} from user's communityIds`);
      throw new Error("Verification failed: Community ID still present in user's communityIds");
    }

    // Clear cached community data to ensure fresh data on next load
    resetCommDataCache();

    // Redirect to the start page
    alert("You have successfully left the community!");
    window.location.href = "./start.html";
  } catch (error) {
    console.error("Error leaving community:", error);
    alert(`Failed to leave the community: ${error.message}. Check the console for details.`);
  }
}

async function fetchCurrentUserData() {
const user = auth.currentUser;
const cacheKey = "currentUserData";
let currentUserData = JSON.parse(sessionStorage.getItem(cacheKey));

if (currentUserData && currentUserData.uid === user.uid) {
//console.log(`Cache hit for current user uid ${user.uid}:`, currentUserData);
return currentUserData;
}

const userRef = doc(db, "users", user.uid);
const userDoc = await getDoc(userRef);

if (!userDoc.exists()) {
console.log(`No user doc found for current uid ${user.uid}`);
const fallbackData = { 
  name: "Unknown", 
  username: "unknown", 
  profilePhoto: null, 
  email: null, 
  city: null, 
  phone: null, 
  uid: user.uid 
};
sessionStorage.setItem(cacheKey, JSON.stringify(fallbackData));
return fallbackData;
}

const userData = userDoc.data();
//console.log(`Fetched current user data for uid ${user.uid}:`, userData);

const cachedData = {
name: userData.name || "Unknown",
username: userData.username || "unknown",
profilePhoto: userData.profilePhoto || null,
email: userData.email || null,
city: userData.city || null,
phone: userData.phone || null,
uid: user.uid
};

sessionStorage.setItem(cacheKey, JSON.stringify(cachedData));
return cachedData;
}

async function fetchUserData(uids) {
if (!uids) return { name: "Unknown", username: "unknown", profilePhoto: "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y", uid: "unknown" };
const uidArray = Array.isArray(uids) ? uids : [uids];

// Check cache first, only fetch what’s missing
const uncachedUids = uidArray.filter(uid => !userDataCache[uid] || userDataCache[uid].name === "Unknown");
if (uncachedUids.length > 0) {
const batches = [];
for (let i = 0; i < uncachedUids.length; i += 10) {
  batches.push(uncachedUids.slice(i, i + 10)); // Batch in groups of 10 (Firestore "in" limit)
}

for (const batch of batches) {
  const q = query(collection(db, "users"), where("__name__", "in", batch));
  const snapshot = await getDocs(q);
  snapshot.forEach(doc => {
    const data = doc.data();
    userDataCache[doc.id] = {
      name: data.name || "Unknown",
      username: data.username || "unknown",
      profilePhoto: data.profilePhoto || "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y",
      email: data.email || null,
      city: data.city || null,
      phone: data.phone || null,
      uid: doc.id,
      swaps: data.swaps || 0 // Ensure swaps is included
    };
    userDataCache[`username:${data.username}`] = userDataCache[doc.id];
  });
  
  // Fallback for any UIDs not found in this batch
  batch.forEach(uid => {
    if (!userDataCache[uid]) {
      userDataCache[uid] = { name: "Unknown", username: "unknown", profilePhoto: "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y", uid };
    }
  });
}
}

// Return from cache
return uidArray.length === 1 ? userDataCache[uidArray[0]] : uidArray.map(uid => userDataCache[uid]);
}

// Add these helper functions right after your existing functions like `fetchUserData` or `createPost`
async function getPostReportStatus(postId) {
const reportsRef = collection(db, "communities", communityId, "postReports");
const q = query(reportsRef, where("postId", "==", postId));
const snapshot = await getDocs(q);
const reportCount = snapshot.size;
const commData = await getCommData();
const user = auth.currentUser;
const isAdmin = commData.admins?.includes(user.uid) || commData.creatorId === user.uid;
const postRef = doc(db, "communities", communityId, "posts", postId);
const postDoc = await getDoc(postRef);

if (!postDoc.exists()) {
console.log(`Post ${postId} not found—assuming deleted.`);
return {
  reportCount,
  isHidden: reportCount >= 2 && !isAdmin, // No owner if deleted
  isAdmin,
  isOwner: false // Can’t own a deleted post
};
}

const postData = postDoc.data();
const isOwner = postData.userId === user.uid;

return {
reportCount,
isHidden: reportCount >= 2 && !isAdmin && !isOwner,
isAdmin,
isOwner
};
}

async function reportPost(postId) {
  const user = auth.currentUser;
  const reportsRef = collection(db, "communities", communityId, "postReports");
  const existingReportQ = query(reportsRef, where("postId", "==", postId), where("reporterId", "==", user.uid));
  const existingReportSnapshot = await getDocs(existingReportQ);

  if (!existingReportSnapshot.empty) {
    alert("You’ve already reported this post!");
    return;
  }

  if (!confirm("Are you sure you want to report this post?")) {
    return;
  }

  await addDoc(reportsRef, {
    postId,
    reporterId: user.uid,
    communityId,
    timestamp: new Date()
  });

  alert("Post reported!");
  refreshReportSummary(user.uid); // Pass user.uid here

  // Update UI without refreshing
  const postDiv = document.getElementById(`post-${postId}`);
  const reportStatus = await getPostReportStatus(postId);
  const commData = await getCommData();
  const isAdmin = commData.admins?.includes(user.uid) || commData.creatorId === user.uid;

  if (postDiv) {
    const existingWarning = postDiv.querySelector(".report-warning");
    const existingAdminControls = postDiv.querySelector(".admin-report-controls");

    if (existingWarning) existingWarning.remove();
    if (existingAdminControls) existingAdminControls.remove();

    if (reportStatus.isHidden) {
      postDiv.remove();
      return;
    }

    if (reportStatus.isOwner) {
      if (reportStatus.reportCount === 1) {
        postDiv.insertAdjacentHTML(
          "beforeend",
          `<div class="report-warning" id="warning-${postId}">
            This post has 1 report. One more will hide it from others—check it in the summary above!
          </div>`
        );
      } else if (reportStatus.reportCount >= 2) {
        postDiv.insertAdjacentHTML(
          "beforeend",
          `<div class="report-warning" id="warning-${postId}">
            This post has ${reportStatus.reportCount} reports and is hidden from others. Appeal in the summary above!
          </div>`
        );
      }
    }

    if (isAdmin && reportStatus.reportCount > 0) {
      postDiv.insertAdjacentHTML(
        "beforeend",
        `<div class="admin-report-controls" id="admin-controls-${postId}">
          This post received ${reportStatus.reportCount} report${reportStatus.reportCount > 1 ? 's' : ''}.
          <button class="remove-post-btn" data-post-id="${postId}">Remove Post</button>
          <button class="clear-reports-btn" data-post-id="${postId}">Clear Reports</button>
        </div>`
      );
      postDiv.querySelector(`.remove-post-btn[data-post-id="${postId}"]`).addEventListener("click", () => deletePost(postId));
      postDiv.querySelector(`.clear-reports-btn[data-post-id="${postId}"]`).addEventListener("click", () => clearReports(postId));
    }
  }

  const yourPostDiv = document.querySelector(`#yourPostsList #post-${postId}`);
  if (yourPostDiv) {
    const existingWarning = yourPostDiv.querySelector(".report-warning");
    if (existingWarning) existingWarning.remove();

    if (reportStatus.isOwner) {
      if (reportStatus.reportCount === 1) {
        yourPostDiv.insertAdjacentHTML(
          "beforeend",
          `<div class="report-warning" id="warning-${postId}">
            This post has 1 report. One more will hide it from others—check it in the summary above!
          </div>`
        );
      } else if (reportStatus.reportCount >= 2) {
        yourPostDiv.insertAdjacentHTML(
          "beforeend",
          `<div class="report-warning" id="warning-${postId}">
            This post has ${reportStatus.reportCount} reports and is hidden from others. Appeal in the summary above!
          </div>`
        );
      }
    }
  }

  await loadAdminReportSummary(user.uid); // Pass user.uid here too
}

async function clearReports(postId) {
if (confirm("Clear all reports for this post? It’ll be visible again.")) {
const user = auth.currentUser; // Grab user for UID
const reportsRef = collection(db, "communities", communityId, "postReports");
const q = query(reportsRef, where("postId", "==", postId));
const snapshot = await getDocs(q);
const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
await Promise.all(deletePromises);
loadPosts(communityId, currentPage); // Keep your page refresh
loadCarouselPosts(communityId);
refreshReportSummary(user.uid); // Live-update the summary UI
}
}

async function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    img.onload = () => {
      const maxWidth = 800;
      const maxHeight = 800;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.7);
    };
    img.src = URL.createObjectURL(file);
  });
}

function setupLocationAutocomplete() {
    const locationInput = document.getElementById("postLocation");
    const suggestionsDiv = document.getElementById("postLocationSuggestions");
  
    if (!locationInput || !suggestionsDiv) {
      console.error("Location input or suggestions div not found!");
      return;
    }
  
    const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
    const CACHE_LIMIT = 50;
    const cache = new Map(); // In-memory cache with expiration
  
    function setCache(key, value) {
      if (cache.size >= CACHE_LIMIT) {
        const firstKey = cache.keys().next().value; // Remove oldest entry
        cache.delete(firstKey);
      }
      cache.set(key, { value, expiry: Date.now() + CACHE_TTL });
    }
  
    function getCache(key) {
      const cached = cache.get(key);
      if (!cached) return null;
      if (Date.now() > cached.expiry) {
        cache.delete(key); // Remove expired cache
        return null;
      }
      return cached.value;
    }
  
    async function fetchLocationSuggestions(query) {
      const cachedData = getCache(query);
      if (cachedData) return cachedData;
  
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
  
      try {
        const response = await fetch(url, { headers: { "User-Agent": "LifeSwap/1.0 (your-email@example.com)" } });
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data = await response.json();
        setCache(query, data);
        return data;
      } catch (error) {
        console.error("Error fetching location suggestions:", error);
        return [];
      }
    }
  
    async function handleInput() {
      const query = locationInput.value.trim();
      if (query.length < 2) {
        suggestionsDiv.innerHTML = "";
        suggestionsDiv.classList.add("hidden");
        return;
      }
  
      suggestionsDiv.innerHTML = "<div class='loading'>⏳ Searching...</div>"; // Loading state
  
      const data = await fetchLocationSuggestions(query);
      displaySuggestions(data);
    }
  
    function displaySuggestions(data) {
      suggestionsDiv.innerHTML = "";
      if (data.length === 0) {
        suggestionsDiv.classList.add("hidden");
        return;
      }
  
      suggestionsDiv.classList.remove("hidden");
      const fragment = document.createDocumentFragment();
  
      data.forEach((place) => {
        const city = place.address.city || place.address.town || place.address.village || "";
        const state = place.address.state || "";
        const country = place.address.country || "";
        const displayName = city && state ? `${city}, ${state}` : place.display_name;
  
        const suggestion = document.createElement("div");
        suggestion.classList.add("suggestion-item");
        suggestion.textContent = displayName;
        suggestion.onclick = () => {
          locationInput.value = displayName;
          locationInput.dataset.lat = place.lat;
          locationInput.dataset.lon = place.lon;
          suggestionsDiv.innerHTML = "";
          suggestionsDiv.classList.add("hidden");
        };
  
        fragment.appendChild(suggestion);
      });
  
      suggestionsDiv.appendChild(fragment);
    }
  
    locationInput.oninput = debounce(handleInput, 500);
  } 

async function editCommunityName(communityId) {
const commRef = doc(db, "communities", communityId);
const commDoc = await getDoc(commRef);
const commData = commDoc.data();
const currentName = commData.name;

// Create a simple form in the DOM
const form = document.createElement("div");
form.id = "edit-name-form";
form.style.position = "fixed";
form.style.top = "50%";
form.style.left = "50%";
form.style.transform = "translate(-50%, -50%)";
form.style.background = "#fff";
form.style.padding = "20px";
form.style.border = "1px solid #ccc";
form.style.boxShadow = "0 0 10px rgba(0,0,0,0.2)";
form.style.zIndex = "1000";
form.innerHTML = `
<h3>Edit Community Name</h3>
<input type="text" id="newCommunityName" value="${currentName}" style="width: 100%; margin-bottom: 10px;">
<button id="saveNameBtn">Save</button>
<button id="cancelNameBtn">Cancel</button>
`;
document.body.appendChild(form);

// Event listeners
document.getElementById("saveNameBtn").addEventListener("click", async () => {
const newName = document.getElementById("newCommunityName").value.trim();
if (!newName) {
  alert("Name can’t be empty!");
  return;
}
if (newName === currentName) {
  alert("That’s already the name!");
  document.body.removeChild(form);
  return;
}

await updateDoc(commRef, { name: newName });
document.getElementById("communityName").textContent = newName;
document.body.removeChild(form);
alert("Community name updated!");
});

document.getElementById("cancelNameBtn").addEventListener("click", () => {
document.body.removeChild(form);
});
}

let reportSummaryCache = null;

async function loadAdminReportSummary(userId) {
  if (!userId) {
    console.error("No userId provided to loadAdminReportSummary");
    return;
  }
  const commData = await getCommData();
  const isAdmin = commData.admins?.includes(userId) || commData.creatorId === userId;

  let summaryDiv = document.getElementById("admin-report-summary");
  if (!summaryDiv) {
    summaryDiv = document.createElement("div");
    summaryDiv.id = "admin-report-summary";
    summaryDiv.className = "admin-report-summary";
    document.querySelector(".community-page").insertBefore(summaryDiv, document.querySelector(".top-bar").nextSibling);
  }

  if (reportSummaryCache) {
    summaryDiv.innerHTML = reportSummaryCache.html;
    attachSummaryListeners(summaryDiv, isAdmin, userId);
    console.log("Loaded report summary from cache!");
    return;
  }

  await updateReportSummaryUI(summaryDiv, userId, isAdmin);
}

async function updateReportSummaryUI(summaryDiv, userId, isAdmin) {
const reportsRef = collection(db, "communities", communityId, "postReports");
const reportsQ = query(reportsRef);
const reportsSnapshot = await getDocs(reportsQ);
const reportCount = Object.keys(reportsSnapshot.docs.reduce((acc, doc) => {
acc[doc.data().postId] = true;
return acc;
}, {})).length;

let userReportCount = 0;
let appealCount = 0;

if (isAdmin) {
const appealsQ = query(collection(db, "communities", communityId, "banAppeals"));
const appealsSnapshot = await getDocs(appealsQ);
appealCount = appealsSnapshot.size;
} else {
const userPostsQ = query(collection(db, "communities", communityId, "posts"), where("userId", "==", userId));
const userPostsSnapshot = await getDocs(userPostsQ);
const reportedPosts = [];
for (const postDoc of userPostsSnapshot.docs) {
  const postId = postDoc.id;
  const reportQ = query(reportsRef, where("postId", "==", postId));
  const reportSnapshot = await getDocs(reportQ);
  if (!reportSnapshot.empty) reportedPosts.push(postId);
}
userReportCount = reportedPosts.length;
}

const totalNotifications = isAdmin ? (reportCount + appealCount) : userReportCount;
summaryDiv.innerHTML = `
<details>
  <summary>${totalNotifications > 0 ? `(${totalNotifications}) ` : ''}See Reports</summary>
  <div id="report-content" class="report-content"></div>
</details>
`;
reportSummaryCache = { html: summaryDiv.innerHTML };
attachSummaryListeners(summaryDiv, isAdmin, userId);
}

// Keep attachSummaryListeners as-is (from last update)
function attachSummaryListeners(summaryDiv, isAdmin, userId) {
  const details = summaryDiv.querySelector("details");
  details.addEventListener("toggle", async () => {
    const contentDiv = summaryDiv.querySelector("#report-content");
    if (details.open) {
      contentDiv.innerHTML = '<div class="loading">⏳ Loading...</div>';
      details.querySelector("summary").textContent = `${reportSummaryCache.html.match(/\(\d+\)/) || ''}Hide Reports`;

      if (isAdmin) {
        let html = "";
        const reportsRef = collection(db, "communities", communityId, "postReports");
        const reportsSnapshot = await getDocs(query(reportsRef));
        if (reportsSnapshot.empty) {
          html += "<p>No reported posts!</p>";
        } else {
          html += "<h3>Reported Posts</h3>";
          const reportCounts = {};
          reportsSnapshot.forEach(doc => {
            const postId = doc.data().postId;
            reportCounts[postId] = (reportCounts[postId] || 0) + 1;
          });
          for (const [postId, count] of Object.entries(reportCounts)) {
            try {
              const postDoc = await getDoc(doc(db, "communities", communityId, "posts", postId));
              const postData = postDoc.exists() ? postDoc.data() : null;
              const title = postData ? postData.title : "Deleted Post";
              const ownerData = postData ? await fetchUserData(postData.userId) : { name: "Unknown" };
              html += `
                <div class="report-item" data-post-id="${postId}">
                  <span>Post "${title}" by ${ownerData.name} (ID: ${postId}) - ${count} report${count > 1 ? 's' : ''}</span>
                  <button class="remove-post-btn" data-post-id="${postId}">Remove Post</button>
                  <button class="clear-reports-btn" data-post-id="${postId}">Clear Reports</button>
                </div>
              `;
            } catch (error) {
              console.error(`Error loading post ${postId}:`, error);
              html += `<p>Error loading post ${postId}</p>`;
            }
          }
        }

        try {
          const appealsSnapshot = await getDocs(collection(db, "communities", communityId, "banAppeals"));
          const commData = (await getDoc(doc(db, "communities", communityId))).data() || { banReasons: {} };
          if (!appealsSnapshot.empty) {
            html += "<br><h3>User Appeals (Bans/Posts)</h3>";
            for (const doc of appealsSnapshot.docs) {
              const appeal = doc.data();
              const userData = await fetchUserData(appeal.userId);
              const displayName = `${userData.name || "Unknown"} (${appeal.username || "unknown"})`;
              const banReason = commData.banReasons?.[appeal.userId] || "No reason provided";
              html += `
                <div class="appeal-item" data-appeal-id="${doc.id}">
                  <p><strong>${displayName}:</strong> "${appeal.message}" (Ban Reason: ${banReason})</p>
                  <span>${new Date(appeal.timestamp.toDate()).toLocaleString()}</span>
                  <button class="delete-appeal-btn" data-appeal-id="${doc.id}">Delete</button>
                </div>
              `;
            }
          } else {
            html += "<br><h3>User Appeals</h3><p>No appeals yet.</p>";
          }
        } catch (error) {
          console.error("Error loading appeals:", error);
          html += "<br><p>Error loading appeals!</p>";
        }

        contentDiv.innerHTML = html;

        contentDiv.querySelectorAll(".remove-post-btn").forEach(btn => {
          btn.addEventListener("click", () => deletePost(btn.dataset.postId));
        });
        contentDiv.querySelectorAll(".clear-reports-btn").forEach(btn => {
          btn.addEventListener("click", () => clearReports(btn.dataset.postId));
        });
        contentDiv.querySelectorAll(".delete-appeal-btn").forEach(btn => {
          btn.addEventListener("click", async () => {
            if (confirm("Delete this appeal?")) {
              await deleteDoc(doc(db, "communities", communityId, "banAppeals", btn.dataset.appealId));
              refreshReportSummary(userId);
            }
          });
        });
      } else {
        // Non-admin logic
        let html = "";
        const reportsRef = collection(db, "communities", communityId, "postReports");
        const userPostsQ = query(collection(db, "communities", communityId, "posts"), where("userId", "==", userId));
        try {
          const userPostsSnapshot = await getDocs(userPostsQ);
          const reportedPosts = [];

          for (const postDoc of userPostsSnapshot.docs) {
            const postId = postDoc.id;
            const reportQ = query(reportsRef, where("postId", "==", postId));
            const reportSnapshot = await getDocs(reportQ);
            if (!reportSnapshot.empty) {
              reportedPosts.push({ postId, title: postDoc.data().title, count: reportSnapshot.size });
            }
          }

          if (reportedPosts.length === 0) {
            html = "<p>No reports on your posts!</p>";
          } else {
            html = "<h3>Your Reported Posts</h3>";
            for (const post of reportedPosts) {
              const appealQ = query(collection(db, "communities", communityId, "banAppeals"), where("userId", "==", userId), where("postId", "==", post.postId));
              const appealSnapshot = await getDocs(appealQ);
              const hasAppeal = !appealSnapshot.empty;

              html += `
                <div class="report-item" data-post-id="${post.postId}">
                  <p>Post "${post.title}" (ID: ${post.postId}) has ${post.count} report${post.count > 1 ? 's' : ''}</p>
                  ${post.count >= 2 ? '<p style="color: red;">Hidden from others!</p>' : ''}
                  <div class="appeal-container" data-post-id="${post.postId}">
                    ${!hasAppeal ? `
                      <form class="appeal-form" data-post-id="${post.postId}">
                        <textarea placeholder="Appeal to admins (e.g., 'Not breaking rules because...')" required></textarea>
                        <button type="submit">Send Appeal</button>
                      </form>
                    ` : '<p>Appeal sent, waiting on admins.</p>'}
                  </div>
                </div>
              `;
            }
          }
        } catch (error) {
          console.error("Error loading user reports:", error);
          html = "<p>Error loading your reports!</p>";
        }

        contentDiv.innerHTML = html;

        // Attach appeal form listeners
        contentDiv.querySelectorAll(".appeal-form").forEach(form => {
          form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const postId = form.dataset.postId;
            const message = form.querySelector("textarea").value.trim();
            if (message) {
              const userDoc = await getDoc(doc(db, "users", userId));
              const userData = userDoc.exists() ? userDoc.data() : { username: `user_${userId.slice(0, 8)}` };

              await addDoc(collection(db, "communities", communityId, "banAppeals"), {
                userId: userId,
                username: userData.username,
                postId,
                message,
                timestamp: new Date()
              });
              alert("Appeal sent!");
              form.closest(".appeal-container").innerHTML = '<p>Appeal sent, waiting on admins.</p>';
              refreshReportSummary(userId);
            }
          });
        });
      }
    } else {
      details.querySelector("summary").textContent = `${reportSummaryCache.html.match(/\(\d+\)/) || ''}See Reports`;
      contentDiv.innerHTML = "";
    }
  });
}

function refreshReportSummary(userId) {
reportSummaryCache = null;
loadAdminReportSummary(userId);
}

const debouncedLoadAdminReportSummary = debounce((userId) => loadAdminReportSummary(userId), 500);

async function createPost() {
  const createPostBtn = document.getElementById("createPostBtn");
  if (!createPostBtn) {
    console.error("Create Post button not found!");
    return;
  }

  // Block if already in progress
  if (createPostBtn.disabled) {
    console.log("Post creation in progress, ignoring extra click.");
    return;
  }

  // Disable button and show loading
  createPostBtn.disabled = true;
  const originalText = createPostBtn.textContent;
  createPostBtn.textContent = "Creating...";
  createPostBtn.classList.add("loading"); // Optional CSS for flair

  try {
    const user = auth.currentUser;
    const title = document.getElementById("postTitle").value.trim();
    const description = document.getElementById("postDescription").value.trim();
    const photos = document.getElementById("postPhotos").files;
    const location = document.getElementById("postLocation").value.trim();
    const lat = document.getElementById("postLocation").dataset.lat;
    const lon = document.getElementById("postLocation").dataset.lon;
    const communityCheckboxes = document.querySelectorAll("#communityCheckboxes input[name='communities']:checked");
    const category = document.getElementById("category").value; // e.g., "clothing_accessories"
    const lookingFor = document.getElementById("lookingFor").value;
    const offering = document.getElementById("offering").value;

    if (!title || !description || !location || !lat || !lon || !category || !lookingFor || !offering) {
      alert("Fill out all fields, pick a category, and select what you're looking for and offering!");
      throw new Error("Missing required fields"); // Throw to hit the finally block
    }

    if (communityCheckboxes.length === 0) {
      alert("Pick at least one community to post!");
      throw new Error("No communities selected");
    }

    let selectedCommunities = Array.from(communityCheckboxes).map(cb => cb.value);

    if (selectedCommunities.length === 1 && selectedCommunities[0] === "all") {
      const userRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userRef);
      selectedCommunities = userDoc.data().communityIds || [];
      const validCommunities = [];
      for (const commId of selectedCommunities) {
        const commRef = doc(db, "communities", commId);
        const commDoc = await getDoc(commRef);
        const commData = commDoc.data();
        if (commData.members.includes(user.uid) && !(commData.bannedUsers || []).includes(user.uid)) {
          validCommunities.push(commId);
        }
      }
      selectedCommunities = validCommunities;
    } else {
      selectedCommunities = selectedCommunities.map(comm => comm === "current" ? communityId : comm);
    }

    if (selectedCommunities.length === 0) {
      alert("No valid communities selected!");
      throw new Error("No valid communities");
    }

    const photoUrlsByCommunity = {};
    for (const commId of selectedCommunities) {
      photoUrlsByCommunity[commId] = [];
      for (let i = 0; i < Math.min(photos.length, 5); i++) {
        const compressedBlob = await compressImage(photos[i]);
        const photoRef = ref(storage, `posts/${commId}/${user.uid}/${Date.now()}_${i}`);
        await uploadBytes(photoRef, compressedBlob);
        const url = await getDownloadURL(photoRef);
        photoUrlsByCommunity[commId].push(url);
      }
    }

    const postPromises = selectedCommunities.map(commId => {
      const postData = {
        title,
        description,
        photoUrls: photoUrlsByCommunity[commId],
        location: { latitude: parseFloat(lat), longitude: parseFloat(lon), name: location },
        userId: user.uid,
        createdAt: new Date(),
        category, // Stores as "clothing_accessories", etc.
        lookingFor,
        offering,
        communityId: commId,
        likes: 0,
        likedBy: [],
        commentCount: 0
      };

      return addDoc(collection(db, "communities", commId, "posts"), postData);
    });
    const postRefs = await Promise.all(postPromises);

    alert(`Post created in ${selectedCommunities.length} communit${selectedCommunities.length > 1 ? 'ies' : 'y'}! IDs: ${postRefs.map(ref => ref.id).join(", ")}`);
    document.getElementById("newPostForm").reset();
    totalYourPosts = 0;
    loadYourPosts(user.uid);
    loadPosts(communityId, true);
    totalCarouselPosts = 0;
    carouselIndex = 0;
    loadCarouselPosts(communityId);

  } catch (error) {
    console.error("Error creating post:", error);
    // Only show alert if it’s not already triggered by validation
    if (!error.message.includes("Missing") && !error.message.includes("communities")) {
      alert(`Failed to create post: ${error.message}`);
    }

  } finally {
    // Always reset the button, no matter what
    createPostBtn.disabled = false;
    createPostBtn.textContent = originalText;
    createPostBtn.classList.remove("loading");
  }
}

async function setupCommunitySelection() {
const user = auth.currentUser;
if (!user) {
console.error("No authenticated user found for setupCommunitySelection!");
return;
}

const userRef = doc(db, "users", user.uid); // Firestore doc
const userDoc = await getDoc(userRef);
const communityIds = userDoc.data().communityIds || [];

const container = document.getElementById("communityCheckboxes");
if (!container) {
console.error("communityCheckboxes div not found in DOM yet!");
return;
}

container.innerHTML = "";

const commRef = doc(db, "communities", communityId); // Firestore doc
const commDoc = await getDoc(commRef);
const currentCommName = commDoc.data().name;
container.innerHTML += `
<label for="comm-current">
  <input type="checkbox" id="comm-current" name="communities" value="current" checked> Current (${currentCommName})
</label>
`;

container.innerHTML += `
<label for="comm-all">
  <input type="checkbox" id="comm-all" name="communities" value="all"> All Communities
</label>
`;

const communityPromises = communityIds
.filter(id => id !== communityId)
.map(id => getDoc(doc(db, "communities", id))); // Firestore doc
const communityDocs = await Promise.all(communityPromises);

for (const commDoc of communityDocs) { // Rename to avoid shadowing
if (commDoc.exists()) {
  const commData = commDoc.data();
  const memberRef = doc(db, "communities", commDoc.id, "members", user.uid); // Firestore doc
  const memberDoc = await getDoc(memberRef);
  const isMember = memberDoc.exists();
  const isBanned = (commData.bannedUsers || []).includes(user.uid);

  if (isMember && !isBanned) {
    const checkbox = document.createElement("label");
    checkbox.setAttribute("for", `comm-${commDoc.id}`);
    checkbox.innerHTML = `
      <input type="checkbox" id="comm-${commDoc.id}" name="communities" value="${commDoc.id}"> ${commData.name}
    `;
    container.appendChild(checkbox);
  }
}
}

const allCheckbox = container.querySelector('input[value="all"]');
allCheckbox.addEventListener("change", (e) => {
const otherCheckboxes = container.querySelectorAll('input[name="communities"]:not([value="all"])');
if (e.target.checked) {
  otherCheckboxes.forEach(cb => cb.checked = false);
}
});

const otherCheckboxes = container.querySelectorAll('input[name="communities"]:not([value="all"])');
otherCheckboxes.forEach(cb => {
cb.addEventListener("change", () => {
  if (cb.checked) {
    allCheckbox.checked = false;
  }
});
});
}

async function deletePost(postId) {
  const user = auth.currentUser;
  const commData = await getCommData();
  const isAdmin = commData.admins?.includes(user.uid) || commData.creatorId === user.uid;
  const postRef = doc(db, "communities", communityId, "posts", postId);
  const postDoc = await getDoc(postRef);
  if (!postDoc.exists()) {
    alert("Post not found!");
    return;
  }
  const postData = postDoc.data();

  if (!isAdmin && postData.userId !== user.uid) {
    alert("You can’t delete this post!");
    return;
  }

  const modal = document.getElementById("deletePostModal");
  const swappedBtn = document.getElementById("swappedBtn");
  const justDeleteBtn = document.getElementById("justDeleteBtn");
  const swapDetails = document.getElementById("swapDetails");
  const swapUsername = document.getElementById("swapUsername");
  const validateSwapBtn = document.getElementById("validateSwapBtn");
  const swapValidationResult = document.getElementById("swapValidationResult");
  const swapConfirmed = document.getElementById("swapConfirmed");
  const swapPartner = document.getElementById("swapPartner");
  const editSwapBtn = document.getElementById("editSwapBtn");
  const proceedSwapBtn = document.getElementById("proceedSwapBtn");
  const swapSuccess = document.getElementById("swapSuccess");
  const swapSuccessMessage = document.getElementById("swapSuccessMessage");
  const closeDeleteModalBtn = document.getElementById("closeDeleteModalBtn");
  const loadingOverlay = document.getElementById("loadingOverlay");

  if (!modal || !loadingOverlay || !swappedBtn || !justDeleteBtn || !swapDetails || !swapUsername || 
      !validateSwapBtn || !swapValidationResult || !swapConfirmed || !swapPartner || 
      !editSwapBtn || !proceedSwapBtn || !swapSuccess || !swapSuccessMessage || !closeDeleteModalBtn) {
    console.error("Missing modal or loading elements:", { modal, loadingOverlay, swappedBtn, justDeleteBtn, swapDetails, swapUsername, validateSwapBtn, swapValidationResult, swapConfirmed, swapPartner, editSwapBtn, proceedSwapBtn, swapSuccess, swapSuccessMessage, closeDeleteModalBtn });
    alert("Error: Modal setup incomplete. Please refresh the page.");
    return;
  }

  let swapPartnerUid = null;

  // Show the modal
  modal.style.display = "flex";
  modal.classList.remove("hidden");
  swapDetails.classList.add("hidden");
  swapSuccess.classList.add("hidden");
  swapValidationResult.textContent = "";
  swapConfirmed.classList.add("hidden");
  proceedSwapBtn.classList.add("hidden");

  // Handle "Just delete it"
  justDeleteBtn.onclick = async () => {
    if (justDeleteBtn.disabled) {
      console.log("Deletion already in progress, ignoring click.");
      return;
    }

    if (confirm("Delete this post from this community? It may still exist in other communities you posted to.")) {
      justDeleteBtn.disabled = true;
      const originalText = justDeleteBtn.textContent;
      justDeleteBtn.textContent = "Deleting...";
      justDeleteBtn.classList.add("loading");
      
      loadingOverlay.classList.remove("hidden");
      try {
        await deletePostAndCleanup(postId, postData.photoUrls, false, null);
        closeModal("deletePostModal");
        refreshReportSummary(user.uid);
      } catch (error) {
        console.error("Deletion failed:", error);
        alert("Something went wrong. Please try again.");
      } finally {
        loadingOverlay.classList.add("hidden");
        justDeleteBtn.disabled = false;
        justDeleteBtn.textContent = originalText;
        justDeleteBtn.classList.remove("loading");
      }
    }
  };

  // Handle "I swapped it"
  swappedBtn.onclick = () => {
    swapDetails.classList.remove("hidden");
    justDeleteBtn.style.display = "none";
    swappedBtn.style.display = "none";
    swapUsername.focus();
  };

  // Validate username
  validateSwapBtn.onclick = async () => {
    const username = swapUsername.value.trim();
    if (!username) {
      swapValidationResult.textContent = "Please enter a username.";
      return;
    }

    swapValidationResult.textContent = "Checking...";
    const userData = await getUserByUsername(username);
    if (userData) {
      swapPartnerUid = userData.uid;
      swapPartner.textContent = username;
      swapValidationResult.textContent = "";
      swapConfirmed.classList.remove("hidden");
      proceedSwapBtn.classList.remove("hidden");
      swapUsername.disabled = true;
      validateSwapBtn.disabled = true;
    } else {
      swapValidationResult.textContent = "User not found.";
      swapPartnerUid = null;
    }
  };

  // Edit swap partner
  editSwapBtn.onclick = () => {
    swapConfirmed.classList.add("hidden");
    proceedSwapBtn.classList.add("hidden");
    swapUsername.disabled = false;
    validateSwapBtn.disabled = false;
    swapUsername.value = "";
    swapValidationResult.textContent = "";
    swapUsername.focus();
  };

  // Proceed with swap
  proceedSwapBtn.onclick = async () => {
    if (proceedSwapBtn.disabled) {
      console.log("Swap deletion already in progress, ignoring click.");
      return;
    }

    if (!swapPartnerUid) {
      swapValidationResult.textContent = "No valid user selected.";
      return;
    }

    const partnerUsername = swapPartner.textContent;
    if (confirm(`Mark this post as swapped with ${partnerUsername} in this community? It may still exist in other communities.`)) {
      proceedSwapBtn.disabled = true;
      const originalText = proceedSwapBtn.textContent;
      proceedSwapBtn.textContent = "Deleting...";
      proceedSwapBtn.classList.add("loading");
      
      loadingOverlay.classList.remove("hidden");
      try {
        await deletePostAndCleanup(postId, postData.photoUrls, true, swapPartnerUid);
        swapDetails.classList.add("hidden");
        swapSuccess.classList.remove("hidden");
        swapSuccessMessage.textContent = `Thanks! You and ${partnerUsername} swapped this item. Help us continue our service free. Tip us!`;
        closeDeleteModalBtn.textContent = "Close";
        refreshReportSummary(user.uid);
      } catch (error) {
        console.error("Swap and deletion failed:", error);
        alert("Something went wrong during the swap. Please try again.");
      } finally {
        loadingOverlay.classList.add("hidden");
        proceedSwapBtn.disabled = false;
        proceedSwapBtn.textContent = originalText;
        proceedSwapBtn.classList.remove("loading");
      }
    }
  };

  // Close modal
  closeDeleteModalBtn.onclick = () => closeModal("deletePostModal");
}

// Helper: Delete post and cleanup efficiently (straight from your old code)
async function deletePostAndCleanup(postId, photoUrls, isSwap, swapPartnerUid) {
  const postRef = doc(db, "communities", communityId, "posts", postId);
  const commentsCollection = collection(db, "communities", communityId, "posts", postId, "comments");

  // Step 1: Transaction for post deletion and swaps (if applicable)
  await runTransaction(db, async (transaction) => {
    if (isSwap && swapPartnerUid) {
      const userRef = doc(db, "users", auth.currentUser.uid);
      const partnerRef = doc(db, "users", swapPartnerUid);

      const userDoc = await transaction.get(userRef);
      const partnerDoc = await transaction.get(partnerRef);

      if (!userDoc.exists() || !partnerDoc.exists()) {
        throw new Error("User or partner not found.");
      }

      const userSwaps = (userDoc.data().swaps || 0) + 1;
      const partnerSwaps = (partnerDoc.data().swaps || 0) + 1;

      transaction.update(userRef, { swaps: userSwaps });
      transaction.update(partnerRef, { swaps: partnerSwaps });
    }

    transaction.delete(postRef);
  });

  // Step 2: Cleanup comments and replies recursively
  await deleteCollection(commentsCollection);

  // Step 3: Delete photos from Storage
  const deletePhotoPromises = photoUrls.map(url => {
    const photoRef = ref(storage, url);
    return deleteObject(photoRef).catch(err => console.error("Failed to delete photo:", err));
  });
  await Promise.all(deletePhotoPromises);

  // Step 4: Refresh UI with immediate DOM removal
  const postElement = document.getElementById(`post-${postId}`);
  if (postElement) {
    postElement.remove(); // Zap it from the DOM right away
    console.log(`Removed post-${postId} from DOM`);
  } else {
    console.log(`Post-${postId} not found in DOM—already gone or never rendered`);
  }

  // Clear caches and reload
  postCache.delete(postId);
  loadedPostIds.delete(postId);
  PaginationState.displayedPostIds.delete(postId); // Clear from displayed set
  totalYourPosts = 0;
  await loadYourPosts(auth.currentUser.uid); // Refresh "Your Posts"
  await loadPosts(communityId, true); // Full reset of community posts
  totalCarouselPosts = 0;
  carouselIndex = 0;
  await loadCarouselPosts(communityId); // Refresh carousel
}

// Helper: Recursively delete a collection and its subcollections (also from your old code)
async function deleteCollection(collectionRef, batchSize = 500) {
  const q = query(collectionRef, limit(batchSize));
  const snapshot = await getDocs(q);

  if (snapshot.empty) return;

  const batch = writeBatch(db);
  for (const doc of snapshot.docs) {
    const repliesCollection = collection(db, doc.ref.path, "replies");
    await deleteCollection(repliesCollection, batchSize); // Recursively delete replies
    batch.delete(doc.ref);
  }
  await batch.commit();

  if (snapshot.size === batchSize) {
    await deleteCollection(collectionRef, batchSize);
  }
}

function setupYourPostsCarousel(postId) {
const carousel = document.getElementById(`carousel-${postId}-your`);
const prevBtn = carousel.querySelector(`.carousel-prev[data-post-id="${postId}-your"]`);
const nextBtn = carousel.querySelector(`.carousel-next[data-post-id="${postId}-your"]`);
const img = carousel.querySelector(".carousel-image");
let photoUrls = JSON.parse(carousel.dataset.photos || "[]");

//console.log(`Setting up YOUR POSTS carousel for post ${postId}:`, { prevBtn, nextBtn, img, photoUrls });

if (!prevBtn || !nextBtn || !img) {
console.error(`Your Posts carousel setup failed for post ${postId}: missing elements`);
return;
}

if (photoUrls.length === 0) {
//console.warn(`No photos for ${postId} in Your Posts, using fallback`);
photoUrls = ["https://firebasestorage.googleapis.com/v0/b/life-swap-6065e.firebasestorage.app/o/static%2Fno-image.webp?alt=media&token=6a974dce-aa63-4d94-b889-a86f626fb430", "https://firebasestorage.googleapis.com/v0/b/life-swap-6065e.firebasestorage.app/o/static%2Fno-image.webp?alt=media&token=6a974dce-aa63-4d94-b889-a86f626fb430"];
}

img.src = photoUrls[0];
img.dataset.index = "0";
let currentIndex = 0;

prevBtn.removeEventListener("click", prevBtn._carouselHandler);
nextBtn.removeEventListener("click", nextBtn._carouselHandler);

prevBtn._carouselHandler = (e) => {
e.preventDefault();
e.stopPropagation();
//console.log(`Prev button clicked for ${postId} in Your Posts by ${auth.currentUser.uid}`);
currentIndex = (currentIndex - 1 + photoUrls.length) % photoUrls.length;
img.src = photoUrls[currentIndex];
img.dataset.index = currentIndex;
//console.log(`Prev clicked for ${postId} in Your Posts, index: ${currentIndex}, url: ${photoUrls[currentIndex]}`);
};

nextBtn._carouselHandler = (e) => {
e.preventDefault();
e.stopPropagation();
//console.log(`Next button clicked for ${postId} in Your Posts by ${auth.currentUser.uid}`);
currentIndex = (currentIndex + 1) % photoUrls.length;
img.src = photoUrls[currentIndex];
img.dataset.index = currentIndex;
//console.log(`Next clicked for ${postId} in Your Posts, index: ${currentIndex}, url: ${photoUrls[currentIndex]}`);
};

prevBtn.addEventListener("click", prevBtn._carouselHandler);
nextBtn.addEventListener("click", nextBtn._carouselHandler);
//console.log(`Listeners attached for ${postId} in Your Posts: prevBtn=${!!prevBtn._carouselHandler}, nextBtn=${!!nextBtn._carouselHandler}`);
}

function setupCommunityCarousel(postId) {
const carousel = document.getElementById(`carousel-${postId}-community`);
const prevBtn = carousel.querySelector(`.carousel-prev[data-post-id="${postId}-community"]`);
const nextBtn = carousel.querySelector(`.carousel-next[data-post-id="${postId}-community"]`);
const img = carousel.querySelector(".carousel-image");
let photoUrls = JSON.parse(carousel.dataset.photos || "[]");

//console.log(`Setting up COMMUNITY carousel for post ${postId}:`, { prevBtn, nextBtn, img, photoUrls });

if (!prevBtn || !nextBtn || !img) {
console.error(`Community carousel setup failed for post ${postId}: missing elements`);
return;
}

if (photoUrls.length === 0) {
//console.warn(`No photos for ${postId} in Community, using fallback`);
photoUrls = ["https://firebasestorage.googleapis.com/v0/b/life-swap-6065e.firebasestorage.app/o/static%2Fno-image.webp?alt=media&token=6a974dce-aa63-4d94-b889-a86f626fb430", "https://firebasestorage.googleapis.com/v0/b/life-swap-6065e.firebasestorage.app/o/static%2Fno-image.webp?alt=media&token=6a974dce-aa63-4d94-b889-a86f626fb430"];
}

img.src = photoUrls[0];
img.dataset.index = "0";
let currentIndex = 0;

prevBtn.removeEventListener("click", prevBtn._carouselHandler);
nextBtn.removeEventListener("click", nextBtn._carouselHandler);

prevBtn._carouselHandler = (e) => {
e.preventDefault();
e.stopPropagation();
//console.log(`Prev button clicked for ${postId} in Community by ${auth.currentUser.uid}`);
currentIndex = (currentIndex - 1 + photoUrls.length) % photoUrls.length;
img.src = photoUrls[currentIndex];
img.dataset.index = currentIndex;
//console.log(`Prev clicked for ${postId} in Community, index: ${currentIndex}, url: ${photoUrls[currentIndex]}`);
};

nextBtn._carouselHandler = (e) => {
e.preventDefault();
e.stopPropagation();
//console.log(`Next button clicked for ${postId} in Community by ${auth.currentUser.uid}`);
currentIndex = (currentIndex + 1) % photoUrls.length;
img.src = photoUrls[currentIndex];
img.dataset.index = currentIndex;
//console.log(`Next clicked for ${postId} in Community, index: ${currentIndex}, url: ${photoUrls[currentIndex]}`);
};

prevBtn.addEventListener("click", prevBtn._carouselHandler);
nextBtn.addEventListener("click", nextBtn._carouselHandler);
//console.log(`Listeners attached for ${postId} in Community: prevBtn=${!!prevBtn._carouselHandler}, nextBtn=${!!nextBtn._carouselHandler}`);
}

// Add these globals near your other vars (around line 320-ish in your original)
// Add these globals near your other vars (around line 320-ish in your original)
// These are already in your code, just confirming they’re there
let lastCarouselDoc = null;
let firstCarouselDoc = null;
let totalCarouselPosts = 0;
let lastFilterState = { lookingFor: "", offering: "" };
let cachedMemberCount = null; // Cache member count

// Helper to get member count (cached)
async function getMemberCount(communityId) {
if (cachedMemberCount !== null) return cachedMemberCount;

const commRef = doc(db, "communities", communityId);
const commDoc = await getDoc(commRef);
if (!commDoc.exists()) {
console.error("Community not found!");
return 0;
}
cachedMemberCount = commDoc.data().memberCount || 0; // Use memberCount from main doc
return cachedMemberCount;
}

async function loadCarouselPosts(communityId, direction = 1) {
const track = document.getElementById("carouselTrack");
const prevBtn = document.getElementById("carouselPrevBtn");
const nextBtn = document.getElementById("carouselNextBtn");
const lookingForFilter = document.getElementById("lookingForFilter")?.value || "";
const offeringFilter = document.getElementById("offeringFilter")?.value || "";
const postsPerPage = window.innerWidth < 768 ? 2 : 4;

track.innerHTML = '<div class="loading">⏳ Loading...</div>';

// Get member count and set trending threshold
const memberCount = await getMemberCount(communityId);
const minLikesThreshold = Math.max(5, Math.ceil(memberCount * 0.01)); // 1% of members or 5, whichever’s higher

// Get total trending post count if not cached or filters changed
const currentFilterState = { lookingFor: lookingForFilter, offering: offeringFilter };
if (totalCarouselPosts === 0 || 
  lastFilterState.lookingFor !== currentFilterState.lookingFor || 
  lastFilterState.offering !== currentFilterState.offering) {
const totalQ = query(
  collection(db, "communities", communityId, "posts"),
  where("likes", ">=", minLikesThreshold),
  ...(lookingForFilter ? [where("lookingFor", "==", lookingForFilter)] : []),
  ...(offeringFilter ? [where("offering", "==", offeringFilter)] : [])
);
totalCarouselPosts = (await getDocs(totalQ)).size;
lastFilterState = currentFilterState;
console.log(`Total trending posts for ${communityId}: ${totalCarouselPosts}`);
}

// Calculate max index
const maxIndex = Math.max(0, Math.ceil(totalCarouselPosts / postsPerPage) - 1);

// Handle looping
if (carouselIndex < 0) {
carouselIndex = maxIndex; // Loop to end
} else if (carouselIndex > maxIndex) {
carouselIndex = 0; // Loop to start
}

// Build the query: only trending posts (likes >= threshold)
let q = query(
collection(db, "communities", communityId, "posts"),
where("likes", ">=", minLikesThreshold),
...(lookingForFilter ? [where("lookingFor", "==", lookingForFilter)] : []),
...(offeringFilter ? [where("offering", "==", offeringFilter)] : []),
orderBy("likes", "desc")
);

if (direction > 0 && carouselIndex > 0 && lastCarouselDoc && carouselIndex <= maxIndex) {
// Forward: Fetch next batch
q = query(q, startAfter(lastCarouselDoc), limit(postsPerPage));
} else if (direction < 0 && carouselIndex >= 0 && firstCarouselDoc && carouselIndex < maxIndex) {
// Backward: Fetch previous batch
q = query(q, endBefore(firstCarouselDoc), limitToLast(postsPerPage));
} else {
// Initial load or loop reset
if (carouselIndex === 0 || totalCarouselPosts <= postsPerPage) {
  q = query(q, limit(postsPerPage)); // Fetch first batch
} else if (carouselIndex === maxIndex) {
  q = query(
    collection(db, "communities", communityId, "posts"),
    where("likes", ">=", minLikesThreshold),
    ...(lookingForFilter ? [where("lookingFor", "==", lookingForFilter)] : []),
    ...(offeringFilter ? [where("offering", "==", offeringFilter)] : []),
    orderBy("likes", "desc"),
    limitToLast(postsPerPage) // Fetch last batch
  );
}
}

const snapshot = await getDocs(q);
const posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), communityId })); // Tag with communityId

// Update pagination cursors
if (snapshot.docs.length > 0) {
lastCarouselDoc = snapshot.docs[snapshot.docs.length - 1];
firstCarouselDoc = snapshot.docs[0];
} else {
// If empty, reset to start or end based on direction
if (direction > 0) {
  carouselIndex = 0;
  q = query(
    collection(db, "communities", communityId, "posts"),
    where("likes", ">=", minLikesThreshold),
    ...(lookingForFilter ? [where("lookingFor", "==", lookingForFilter)] : []),
    ...(offeringFilter ? [where("offering", "==", offeringFilter)] : []),
    orderBy("likes", "desc"),
    limit(postsPerPage)
  );
} else if (direction < 0) {
  carouselIndex = maxIndex;
  q = query(
    collection(db, "communities", communityId, "posts"),
    where("likes", ">=", minLikesThreshold),
    ...(lookingForFilter ? [where("lookingFor", "==", lookingForFilter)] : []),
    ...(offeringFilter ? [where("offering", "==", offeringFilter)] : []),
    orderBy("likes", "desc"),
    limitToLast(postsPerPage)
  );
}
const resetSnapshot = await getDocs(q);
posts.push(...resetSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), communityId })));
if (resetSnapshot.docs.length > 0) {
  lastCarouselDoc = resetSnapshot.docs[resetSnapshot.docs.length - 1];
  firstCarouselDoc = resetSnapshot.docs[0];
}
}

// Cache posts with communityId
posts.forEach(post => {
if (!postCache.has(post.id)) {
  postCache.set(post.id, post);
  console.log(`Cached carousel post ${post.id} for ${communityId}`);
}
});

// Render posts, filtering by communityId
track.innerHTML = posts.length === 0 ? '<p class="no-posts">No trending posts yet!</p>' : "";
for (const post of posts) {
if (post.communityId !== communityId) {
  console.log(`Skipping carousel post ${post.id}—belongs to ${post.communityId}, not ${communityId}`);
  continue;
}

const userData = await fetchUserData(post.userId);
const postDiv = document.createElement("div");
postDiv.className = "carousel-post";
postDiv.innerHTML = `
  <h4>${post.title || "Untitled"}</h4>
  <p class="highlight">Looking For: ${post.lookingFor || "N/A"}</p>
  <p class="highlight">Offering: ${post.offering || "N/A"}</p>
  <p>❤️ Likes: ${post.likes || 0}</p>
  <p>By: <span class="username" data-uid="${post.userId}">${userData.name || "Unknown"}</span></p>
  <button class="copy-btn" data-post-id="${post.id}">Copy Post ID</button>
`;
track.appendChild(postDiv);
postDiv.querySelector(".username").addEventListener("click", () => viewProfile(post.userId));
postDiv.querySelector(".copy-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  copyPostId(post.id);
});
}

// Keep buttons enabled for looping, disable if no posts
prevBtn.disabled = totalCarouselPosts === 0;
nextBtn.disabled = totalCarouselPosts === 0;

console.log(`Loaded carousel posts for community ${communityId}, index: ${carouselIndex}`);
}

function slideCarousel(direction) {
carouselIndex += direction;
loadCarouselPosts(communityId, direction);
}

// Add delay helper
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Session storage keys with expiration
const POST_CACHE_KEY = `postCache_${communityId}`;
const LIKED_PREFS_KEY = `likedPrefs_${communityId}`;
const CACHE_TIMESTAMP_KEY = `cacheTimestamp_${communityId}`;
const CACHE_EXPIRY_HOURS = 8;

const PaginationState = {
POSTS_PER_PAGE: 10,
currentPage: 1,
displayedPostIds: new Set()
};

function isCacheExpired() {
const timestamp = sessionStorage.getItem(CACHE_TIMESTAMP_KEY);
if (!timestamp) return true;
const ageMs = Date.now() - parseInt(timestamp);
return ageMs > (CACHE_EXPIRY_HOURS * 60 * 60 * 1000);
}

function resetCache() {
sessionStorage.removeItem(POST_CACHE_KEY);
sessionStorage.removeItem(LIKED_PREFS_KEY);
sessionStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
}

function getLikedPrefs() {
if (isCacheExpired()) resetCache();
const cached = sessionStorage.getItem(LIKED_PREFS_KEY);
if (!cached) return { categories: new Set(), offerings: new Set() };
const parsed = JSON.parse(cached);
return {
categories: new Set(parsed.categories),
offerings: new Set(parsed.offerings)
};
}

function addLikedPref(category, offering) {
const prefs = getLikedPrefs();
prefs.categories.add(category);
prefs.offerings.add(offering);
sessionStorage.setItem(LIKED_PREFS_KEY, JSON.stringify({
categories: Array.from(prefs.categories),
offerings: Array.from(prefs.offerings)
}));
}

function normalizePostData(postData) {
return {
...postData,
createdAt: postData.createdAt instanceof Object && 'toDate' in postData.createdAt 
  ? postData.createdAt.toDate() 
  : new Date(postData.createdAt)
};
}

function getCachedPosts() {
if (isCacheExpired()) resetCache();
const cached = sessionStorage.getItem(POST_CACHE_KEY);
if (!cached) return new Map();
const postArray = JSON.parse(cached);
return new Map(postArray.map(([id, post]) => {
post.data.createdAt = new Date(post.data.createdAt);
return [id, post];
}));
}

function setCachedPosts(postMap) {
const MAX_CACHED_POSTS = 1000; // Cap at 1000 posts (~1-2 MB)
const serializableMap = new Map(Array.from(postMap.entries()).map(([id, post]) => {
return [id, { ...post, data: { ...post.data, createdAt: post.data.createdAt.toISOString() } }];
}));

if (serializableMap.size > MAX_CACHED_POSTS) {
const excess = serializableMap.size - MAX_CACHED_POSTS;
const oldestKeys = Array.from(serializableMap.keys()).slice(0, excess);
oldestKeys.forEach(key => serializableMap.delete(key));
console.log(`Trimmed ${excess} oldest posts from cache`);
}

sessionStorage.setItem(POST_CACHE_KEY, JSON.stringify(Array.from(serializableMap.entries())));
if (!sessionStorage.getItem(CACHE_TIMESTAMP_KEY)) {
sessionStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
}
}

function getPostScore(postData, likedPrefs) {
const now = Date.now();
const ageInHours = (now - postData.createdAt.getTime()) / (1000 * 60 * 60);
const recencyScore = Math.max(0, 30 - (ageInHours / 24)) / 30;
const likesScore = Math.min(postData.likes || 0, 50) / 50;
const commentsScore = Math.min(postData.commentCount || 0, 20) / 20;

let score = (0.4 * likesScore) + (0.4 * commentsScore) + (0.2 * recencyScore);
const userCategories = new Set(likedPrefs.categories);
const userOfferings = new Set(likedPrefs.offerings);
if (userCategories.has(postData.category) || userOfferings.has(postData.offering)) {
score += 0.3;
}
if (ageInHours < 24) {
score += 0.5;
}
return Math.min(1.5, score);
}

async function loadPosts(communityId, reset = false, page = PaginationState.currentPage) {
if (isFetching || isSearching) return;
isFetching = true;

const postsDiv = document.getElementById("postList");
const caughtUpDiv = document.getElementById("caughtUpMessage");
const filters = {
category: document.getElementById("categoryFilter")?.value || "",
lookingFor: document.getElementById("lookingForFilter")?.value || "",
offering: document.getElementById("offeringFilter")?.value || ""
};

if (reset) {
postsDiv.innerHTML = "";
caughtUpDiv.style.display = "none";
loadedPostIds.clear();
PaginationState.displayedPostIds.clear();
lastPostDoc = null;
postCache.clear();
PaginationState.currentPage = 1;
resetCache();
console.log(`Reset post list and caches for community ${communityId}`);
}

PaginationState.currentPage = page;
const cachedPosts = getCachedPosts();
const likedPrefs = getLikedPrefs();
const batchSize = 25;

let lastCachedTime = null;
if (cachedPosts.size > 0) {
const times = Array.from(cachedPosts.values())
  .filter(post => post.data.communityId === communityId)
  .map(post => post.data.createdAt.getTime());
lastCachedTime = times.length > 0 ? Math.max(...times) : null;
console.log(`Using ${times.length} cached posts for ${communityId}, last cached at: ${lastCachedTime ? new Date(lastCachedTime).toLocaleString() : 'N/A'}`);
} else {
console.log(`No cached posts found for ${communityId}—fetching fresh batch.`);
}

const startIndex = (PaginationState.currentPage - 1) * PaginationState.POSTS_PER_PAGE;
const endIndex = startIndex + PaginationState.POSTS_PER_PAGE;

let allPosts = Array.from(cachedPosts.values())
.filter(post => post.data.communityId === communityId)
.map(post => ({
  ...post,
  score: getPostScore(post.data, likedPrefs)
}))
.filter(post => 
  (!filters.category || post.data.category === filters.category) &&
  (!filters.lookingFor || post.data.lookingFor === filters.lookingFor) &&
  (!filters.offering || post.data.offering === filters.offering)
)
.sort((a, b) => b.score - a.score);

const postsToShow = allPosts.slice(startIndex, endIndex)
.filter(post => !PaginationState.displayedPostIds.has(post.id));
const cacheHasEnough = postsToShow.length === PaginationState.POSTS_PER_PAGE || 
                    (startIndex + postsToShow.length >= allPosts.length);

if (!cacheHasEnough || reset || cachedPosts.size === 0) {
let q = query(
  collection(db, "communities", communityId, "posts"),
  ...(filters.category ? [where("category", "==", filters.category)] : []),
  ...(filters.lookingFor ? [where("lookingFor", "==", filters.lookingFor)] : []),
  ...(filters.offering ? [where("offering", "==", filters.offering)] : []),
  orderBy("createdAt", "desc"),
  limit(batchSize),
  ...(lastPostDoc && !reset ? [startAfter(lastPostDoc)] : []),
  ...(lastCachedTime && !reset ? [where("createdAt", ">", new Date(lastCachedTime))] : [])
);

try {
  const snapshot = await getDocs(q);
  const newPosts = snapshot.docs.map(doc => ({
    id: doc.id,
    data: { ...normalizePostData(doc.data()), communityId },
    score: getPostScore(normalizePostData(doc.data()), likedPrefs)
  }));

  console.log(`Fetched ${newPosts.length} new posts for ${communityId} (${batchSize} reads)`);

  newPosts.forEach(post => cachedPosts.set(post.id, post));
  setCachedPosts(cachedPosts);

  allPosts = Array.from(cachedPosts.values())
    .filter(post => post.data.communityId === communityId)
    .map(post => ({
      ...post,
      score: getPostScore(post.data, likedPrefs)
    }))
    .filter(post => 
      (!filters.category || post.data.category === filters.category) &&
      (!filters.lookingFor || post.data.lookingFor === filters.lookingFor) &&
      (!filters.offering || post.data.offering === filters.offering)
    )
    .sort((a, b) => b.score - a.score);
} catch (error) {
  console.error(`Failed to load posts for ${communityId}:`, error);
  postsDiv.innerHTML = "<p>Oops, something broke! Refresh.</p>";
  isFetching = false;
  return;
}
}

const finalPostsToShow = allPosts.slice(startIndex, endIndex)
.filter(post => !PaginationState.displayedPostIds.has(post.id));
console.log(`Showing ${finalPostsToShow.length} posts for ${communityId} on page ${PaginationState.currentPage}`);

if (finalPostsToShow.length === 0 && !initialPostsLoaded) {
postsDiv.innerHTML = "<p>No new posts to show!</p>";
caughtUpDiv.style.display = "none";
} else {
totalPosts = totalPosts || parseInt(sessionStorage.getItem(`totalPosts_${communityId}`)) || (await getTotalPosts(communityId));
sessionStorage.setItem(`totalPosts_${communityId}`, totalPosts);
initialPostsLoaded = true;

finalPostsToShow.forEach(post => postCache.set(post.id, { id: post.id, data: post.data }));
const savedPostsQ = query(collection(doc(db, "users", auth.currentUser.uid), "savedPosts"), where("communityId", "==", communityId));
const savedPostsSnapshot = await getDocs(savedPostsQ);
const savedPostIds = new Set(savedPostsSnapshot.docs.map(doc => doc.data().postId));

postsDiv.innerHTML = "";
PaginationState.displayedPostIds.clear();
await renderPosts({ docs: finalPostsToShow.map(post => ({ id: post.id, data: () => post.data })) }, postsDiv, savedPostIds);

addPaginationControls(postsDiv, allPosts.length, communityId);
caughtUpDiv.style.display = PaginationState.currentPage * PaginationState.POSTS_PER_PAGE >= totalPosts ? "block" : "none";
}

isFetching = false;
}

// Add filter change listeners (from your community.html)
document.getElementById("categoryFilter")?.addEventListener("change", () => loadPosts(communityId, true));
document.getElementById("lookingForFilter")?.addEventListener("change", () => loadPosts(communityId, true));
document.getElementById("offeringFilter")?.addEventListener("change", () => loadPosts(communityId, true));

async function renderPosts(snapshot, postsDiv, savedPostIds) {
const commData = await getCommData();
const isAdmin = commData?.admins?.includes(auth.currentUser.uid) || commData?.creatorId === auth.currentUser.uid;

const uids = [...new Set(snapshot.docs.map(doc => doc.data().userId).filter(Boolean))];
await fetchUserData(uids);

for (const postDoc of snapshot.docs) {
const postId = postDoc.id;
if (PaginationState.displayedPostIds.has(postId)) continue;
if (PaginationState.displayedPostIds.size >= PaginationState.POSTS_PER_PAGE) break;

const post = postCache.get(postId)?.data || postDoc.data();

if (post.communityId && post.communityId !== communityId) {
  console.log(`Skipping post ${postId}—belongs to ${post.communityId}, not ${communityId}`);
  continue;
}

PaginationState.displayedPostIds.add(postId);
loadedPostIds.add(postId);

const userData = userDataCache[post.userId] || { profilePhoto: 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y', name: 'Unknown', username: 'unknown' };
const isPostAdmin = commData?.admins?.includes(post.userId) || commData?.creatorId === post.userId;
const commentsQ = query(collection(db, "communities", communityId, "posts", postId, "comments"), orderBy("createdAt", "desc"));
const commentsSnapshot = await getDocs(commentsQ);
const commentCount = commentsSnapshot.size;
const timestamp = post.createdAt ? new Date(post.createdAt).toLocaleString() : "N/A";
const photoUrls = post.photoUrls || [];
const photoCount = photoUrls.length;
const reportStatus = await getPostReportStatus(postId);
const isSaved = savedPostIds.has(postId);
const displayCategory = categoryDisplayMap[post.category] || post.category;

if (reportStatus?.isHidden) {
  PaginationState.displayedPostIds.delete(postId);
  loadedPostIds.delete(postId);
  continue;
}

const postDiv = document.createElement("div");
postDiv.className = "post";
postDiv.id = `post-${postId}`;
postDiv.innerHTML = `
  <div class="post-header">
    <img loading="lazy" src="${userData.profilePhoto}" class="profile-photo" alt="Profile">
    <h3><span class="username" data-uid="${post.userId}">${userData.name}</span> <span class="at-user">@${userData.username}</span> ${isPostAdmin ? '<span class="admin-tag">Admin</span>' : ''}</h3>
  </div>
  <h3>${post.title || 'Untitled'}</h3>
  <p class="post-description">${post.description || ''}</p>
  <div class="photo-carousel" id="carousel-${postId}-community" data-photos='${JSON.stringify(photoUrls)}'>
    ${photoCount > 1 ? `<button class="carousel-prev" data-post-id="${postId}-community"><</button>` : ''}
    <img loading="lazy" src="${photoUrls[0] || 'https://firebasestorage.googleapis.com/v0/b/life-swap-6065e.firebasestorage.app/o/static%2Fno-image.webp?alt=media&token=6a974dce-aa63-4d94-b889-a86f626fb430'}" alt="Post photo" class="carousel-image" data-index="0">
    ${photoCount > 1 ? `<button class="carousel-next" data-post-id="${postId}-community">></button>` : ''}
  </div>
  <p>Location: ${post.location?.name || 'N/A'}</p>
  <p>Category: ${displayCategory}</p>
  <p class="highlight">Looking For: ${post.lookingFor || 'N/A'} | Offering: ${post.offering || 'N/A'}</p>
  <p class="timestamp">${timestamp}</p>
  <p class="post-id">Post ID: ${postId} <button class="copy-btn" data-post-id="${postId}">Copy</button></p>
  <button class="like-btn" data-post-id="${postId}">${(post.likedBy || []).includes(auth.currentUser.uid) ? '💔 Unlike' : '❤️ Like'} (${post.likes || 0})</button>
  <button class="save-toggle-btn" data-post-id="${postId}" data-community-id="${communityId}">${isSaved ? "🗑️ Unsave" : "💾 Save"}</button>
  <button class="report-btn" id="reportPost-${postId}">Report Post</button>
  <br><br>
  ${post.userId === auth.currentUser.uid || isAdmin ? `<button class="delete-btn" id="deletePost-${postId}">Delete Post</button>` : ""}
  ${reportStatus?.isOwner && reportStatus.reportCount === 1 ? `
    <div class="report-warning" id="warning-${postId}">
      This post has 1 report. One more hides it—check summary!
    </div>` : ""}
  ${reportStatus?.isOwner && reportStatus.reportCount >= 2 ? `
    <div class="report-warning" id="warning-${postId}">
      This post has ${reportStatus.reportCount} reports and is hidden. Appeal above!
    </div>` : ""}
  ${isAdmin && reportStatus?.reportCount > 0 ? `
    <div class="admin-report-controls" id="admin-controls-${postId}">
      This post has ${reportStatus.reportCount} report${reportStatus.reportCount > 1 ? 's' : ''}.
      <button class="remove-post-btn" data-post-id="${postId}">Remove Post</button>
      <button class="clear-reports-btn" data-post-id="${postId}">Clear Reports</button>
    </div>` : ""}
  <div class="comments-section">
    <a href="#" class="comment-count" id="toggleComments-${postId}">${commentCount} comments</a>
    <div class="comments-thread" id="comments-${postId}" style="display: none;"></div>
    <form id="commentForm-${postId}" class="comment-form">
      <textarea placeholder="Add a comment..." required></textarea>
      <div id="tagSuggestions-${postId}" class="suggestions hidden"></div>
      <button type="submit">Comment</button>
    </form>
  </div>
`;

postsDiv.appendChild(postDiv);

const likeBtn = postDiv.querySelector(`.like-btn[data-post-id="${postId}"]`);
likeBtn.addEventListener("click", async () => {
  const postRef = doc(db, "communities", communityId, "posts", postId);
  const postSnapshot = await getDoc(postRef);
  if (!postSnapshot.exists()) {
    alert("Post not found—might’ve been deleted!");
    return;
  }
  const postData = normalizePostData(postSnapshot.data());
  const userId = auth.currentUser.uid;
  const likedBy = postData.likedBy || [];
  let newLikes = postData.likes || 0;
  let newLikedBy = [...likedBy];
  if (likedBy.includes(userId)) {
    newLikedBy = newLikedBy.filter(id => id !== userId);
    newLikes = Math.max(0, newLikes - 1);
  } else {
    newLikedBy.push(userId);
    newLikes += 1;
    addLikedPref(postData.category, postData.offering);
  }
  await updateDoc(postRef, { likes: newLikes, likedBy: newLikedBy });
  likeBtn.textContent = `${likedBy.includes(userId) ? '❤️ Like' : '💔 Unlike'} (${newLikes})`;
  const cachedPosts = getCachedPosts();
  cachedPosts.set(postId, { id: postId, data: { ...postData, likes: newLikes, likedBy: newLikedBy, communityId } });
  setCachedPosts(cachedPosts);
});

const saveToggleBtn = postDiv.querySelector(`.save-toggle-btn[data-post-id="${postId}"]`);
saveToggleBtn.replaceWith(saveToggleBtn.cloneNode(true));
const newSaveToggleBtn = postDiv.querySelector(`.save-toggle-btn[data-post-id="${postId}"]`);
let isProcessing = false;
newSaveToggleBtn.addEventListener("click", (e) => {
  e.preventDefault();
  if (isProcessing) return;
  isProcessing = true;
  if (newSaveToggleBtn.textContent === "Unsave") {
    deleteSavedPostFromPost(postId, communityId, newSaveToggleBtn)
      .then(() => isProcessing = false)
      .catch(() => isProcessing = false);
  } else {
    savePost(postId, communityId, newSaveToggleBtn)
      .then(() => isProcessing = false)
      .catch(() => isProcessing = false);
  }
});

postDiv.querySelector(`.username[data-uid="${post.userId}"]`)?.addEventListener("click", () => viewProfile(post.userId));
postDiv.querySelector(`#toggleComments-${postId}`)?.addEventListener("click", (e) => {
  e.preventDefault();
  toggleComments(postId);
});
postDiv.querySelector(`#commentForm-${postId}`)?.addEventListener("submit", (e) => {
  e.preventDefault();
  addComment(postId, post.userId);
});
postDiv.querySelector(`#deletePost-${postId}`)?.addEventListener("click", () => deletePost(postId));
postDiv.querySelector(`#reportPost-${postId}`)?.addEventListener("click", () => reportPost(postId));
postDiv.querySelector(`.copy-btn[data-post-id="${postId}"]`)?.addEventListener("click", (e) => {
  e.stopPropagation();
  copyPostId(postId);
});
if (isAdmin) {
  postDiv.querySelector(`.remove-post-btn[data-post-id="${postId}"]`)?.addEventListener("click", () => deletePost(postId));
  postDiv.querySelector(`.clear-reports-btn[data-post-id="${postId}"]`)?.addEventListener("click", () => clearReports(postId));
}
const textarea = postDiv.querySelector(`#commentForm-${postId} textarea`);
if (textarea) {
  if (textarea._debouncedInput) textarea.removeEventListener("input", textarea._debouncedInput);
  textarea._debouncedInput = debounce((e) => showTagSuggestions(e.target, postId), 500);
  textarea.addEventListener("input", textarea._debouncedInput);
}
if (photoCount > 1) setupCommunityCarousel(postId);
}
}

function addPaginationControls(postsDiv, totalPostsCount, communityId) {
const totalPages = Math.ceil(totalPostsCount / PaginationState.POSTS_PER_PAGE);
const paginationDiv = document.createElement("div");
paginationDiv.className = "pagination";

if (PaginationState.currentPage > 1) {
const prevBtn = document.createElement("button");
prevBtn.textContent = "<";
prevBtn.addEventListener("click", async () => {
  if (PaginationState.currentPage > 1) {
    postsDiv.innerHTML = '<div class="loading">⏳ Loading...</div>';
    await loadPosts(communityId, false, PaginationState.currentPage - 1);
  }
});
paginationDiv.appendChild(prevBtn);
}

const pagesToShow = [1];
if (totalPages <= 5) {
for (let i = 2; i <= totalPages; i++) pagesToShow.push(i);
} else {
const nearPages = [PaginationState.currentPage - 1, PaginationState.currentPage, PaginationState.currentPage + 1].filter(p => p > 1 && p < totalPages);
pagesToShow.push(...nearPages);
if (!pagesToShow.includes(totalPages)) pagesToShow.push(totalPages);
if (PaginationState.currentPage > 3 && !pagesToShow.includes(2)) pagesToShow.push(2);
if (PaginationState.currentPage < totalPages - 2 && !pagesToShow.includes(totalPages - 1)) pagesToShow.push(totalPages - 1);
pagesToShow.sort((a, b) => a - b);
}

pagesToShow.forEach((pageNum, index) => {
if (index > 0 && pageNum - pagesToShow[index - 1] > 1) {
  const ellipsis = document.createElement("span");
  ellipsis.textContent = "...";
  paginationDiv.appendChild(ellipsis);
}
const pageBtn = document.createElement("button");
pageBtn.textContent = pageNum;
pageBtn.className = pageNum === PaginationState.currentPage ? "active" : "";
if (pageNum === PaginationState.currentPage) {
  pageBtn.disabled = true;
} else {
  pageBtn.addEventListener("click", async () => {
    postsDiv.innerHTML = '<div class="loading">⏳ Loading...</div>';
    await loadPosts(communityId, false, pageNum);
  });
}
paginationDiv.appendChild(pageBtn);
});

if (PaginationState.currentPage < totalPages) {
const nextBtn = document.createElement("button");
nextBtn.textContent = ">";
nextBtn.addEventListener("click", async () => {
  if (PaginationState.currentPage < totalPages) {
    postsDiv.innerHTML = '<div class="loading">⏳ Loading...</div>';
    await loadPosts(communityId, false, PaginationState.currentPage + 1);
  }
});
paginationDiv.appendChild(nextBtn);
}

postsDiv.appendChild(paginationDiv);
}

document.getElementById("refreshPostsBtn").addEventListener("click", async () => {
await loadPosts(communityId, true);
});

let totalYourPosts = 0; // Global, cached total

async function loadYourPosts(userId) {
const yourPostsList = document.getElementById("yourPostsList");
yourPostsList.innerHTML = "";
let lastYourPostDoc = null;
let firstYourPostDoc = null;
let shownPostIds = new Set();

async function fetchYourPosts(reset = false) {
const commData = await getCommData();
const isAdmin = commData.admins?.includes(auth.currentUser.uid) || commData.creatorId === auth.currentUser.uid;
await fetchUserData(userId);

const scrollTop = reset ? 0 : (window.scrollY || document.documentElement.scrollTop);

// Fetch total only if not cached
if (!totalYourPosts || reset) {
  const totalQ = query(collection(db, "communities", communityId, "posts"), where("userId", "==", userId));
  totalYourPosts = (await getDocs(totalQ)).size;
}

let q = query(
  collection(db, "communities", communityId, "posts"),
  where("userId", "==", userId),
  orderBy("createdAt", "desc"),
  limit(2)
);
if (lastYourPostDoc && !reset) q = query(q, startAfter(lastYourPostDoc));
else if (reset) firstYourPostDoc = null;

try {
  const snapshot = await getDocs(q);
  if (snapshot.empty && shownPostIds.size === 0) {
    yourPostsList.innerHTML = "<p>No posts yet!</p>";
    await updateButtons();
    if (!reset) window.scrollTo(0, scrollTop);
    else document.getElementById("scroll-to-ur-posts")?.scrollIntoView({ behavior: "smooth" });
    return;
  }

  if (!firstYourPostDoc) firstYourPostDoc = snapshot.docs[0];
  lastYourPostDoc = snapshot.docs[snapshot.docs.length - 1];

  if (reset) {
    yourPostsList.innerHTML = "";
    shownPostIds.clear();
  }

  // Batch fetch report status for all posts in this snapshot
  const postIds = snapshot.docs.map(doc => doc.id);
  const reportStatuses = await Promise.all(postIds.map(getPostReportStatus));

  for (let i = 0; i < snapshot.docs.length; i++) {
    const doc = snapshot.docs[i];
    const reportStatus = reportStatuses[i];
    if (shownPostIds.has(doc.id)) continue;
    shownPostIds.add(doc.id);

    const post = doc.data();
    if (!post.userId) {
      console.error(`Post ${doc.id} has no userId! Post data:`, post);
      yourPostsList.innerHTML += `<div class="post-error">Error: Post ${doc.id} is missing user data.</div>`;
      continue;
    }
    const userData = userDataCache[post.userId];
    const isPostAdmin = commData.admins?.includes(post.userId) || commData.creatorId === post.userId;
    const timestamp = new Date(post.createdAt.toDate()).toLocaleString();
    const photoUrls = post.photoUrls || [];
    const photoCount = photoUrls.length;

    const postDiv = document.createElement("div");
    postDiv.className = "post";
    postDiv.id = `post-${doc.id}`;
    postDiv.innerHTML = `
      <div class="post-header">
        <img loading="lazy" src="${userData.profilePhoto || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'}" class="profile-photo" alt="Profile">
        <h3><span class="username" data-uid="${post.userId}">${userData.name}</span> <span class="at-user">@${userData.username}</span> ${isPostAdmin ? '<span class="admin-tag">Admin</span>' : ''}</h3>
      </div>
      <h3>${post.title}</h3>
      <p class="post-description">${post.description}</p>
      <div class="photo-carousel" id="carousel-${doc.id}-your" data-photos='${JSON.stringify(photoUrls)}'>
        ${photoCount > 1 ? `<button class="carousel-prev" data-post-id="${doc.id}-your"><</button>` : ''}
        <img loading="lazy" src="${photoUrls[0] || 'https://firebasestorage.googleapis.com/v0/b/life-swap-6065e.firebasestorage.app/o/static%2Fno-image.webp?alt=media&token=6a974dce-aa63-4d94-b889-a86f626fb430'}" alt="Post photo" class="carousel-image" data-index="0">
        ${photoCount > 1 ? `<button class="carousel-next" data-post-id="${doc.id}-your">></button>` : ''}
      </div>
      <p>Location: ${post.location.name}</p>
      <p class="highlight">Category: ${post.category || 'N/A'} | Looking For: ${post.lookingFor || 'N/A'} | Offering: ${post.offering || 'N/A'}</p>
      <p class="timestamp">${timestamp}</p>
      <p class="post-id">Post ID: ${doc.id} <button class="copy-btn" data-post-id="${doc.id}">Copy</button></p>
      ${post.userId === auth.currentUser.uid || isAdmin ? `<button class="delete-btn" id="deletePost-${doc.id}">Delete Post</button>` : ""}
      ${reportStatus.isOwner && reportStatus.reportCount === 1 ? `
        <div class="report-warning" id="warning-${doc.id}">
          This post has 1 report. One more hides it—check summary!
        </div>` : ""}
      ${reportStatus.isOwner && reportStatus.reportCount >= 2 ? `
        <div class="report-warning" id="warning-${doc.id}">
          This post has ${reportStatus.reportCount} reports and is hidden. Appeal above!
        </div>` : ""}
    `;
    yourPostsList.appendChild(postDiv);

    postDiv.querySelector(`.username[data-uid="${post.userId}"]`).addEventListener("click", () => viewProfile(post.userId));
    const deleteBtn = postDiv.querySelector(`#deletePost-${doc.id}`);
    if (deleteBtn) deleteBtn.addEventListener("click", () => deletePost(doc.id));
    postDiv.querySelector(`.copy-btn[data-post-id="${doc.id}"]`).addEventListener("click", (e) => {
      e.stopPropagation();
      copyPostId(doc.id);
    });
    if (photoCount > 1) setupYourPostsCarousel(doc.id);
  }

  await updateButtons();
  if (!reset) window.scrollTo(0, scrollTop);
  else document.getElementById("scroll-to-ur-posts")?.scrollIntoView({ behavior: "smooth" });
} catch (error) {
  console.error("Failed to load your posts:", error);
  yourPostsList.innerHTML = "<p>Oops, something broke! Try refreshing.</p>";
  if (!reset) window.scrollTo(0, scrollTop);
  else document.getElementById("scroll-to-ur-posts")?.scrollIntoView({ behavior: "smooth" });
}
}

async function updateButtons() {
const existingMoreBtn = yourPostsList.querySelector("#seeMoreYourPostsBtn");
const existingLessBtn = yourPostsList.querySelector("#seeLessYourPostsBtn");
if (existingMoreBtn) existingMoreBtn.remove();
if (existingLessBtn) existingLessBtn.remove();

const buttonContainer = document.createElement("div");
buttonContainer.id = "yourPostsButtons";
buttonContainer.style.cssText = "margin-top: 10px; text-align: center; display: block !important; visibility: visible !important;";

const seeMoreBtn = document.createElement("button");
seeMoreBtn.id = "seeMoreYourPostsBtn";
seeMoreBtn.textContent = "See More";
seeMoreBtn.className = "see-more-btn";
seeMoreBtn.style.cssText = "display: block !important; margin: 5px auto; padding: 5px 10px; visibility: visible !important; opacity: 1 !important; position: relative !important;";
seeMoreBtn.addEventListener("click", () => fetchYourPosts());

const seeLessBtn = document.createElement("button");
seeLessBtn.id = "seeLessYourPostsBtn";
seeLessBtn.textContent = "See Less";
seeLessBtn.className = "see-less-btn";
seeLessBtn.style.cssText = "display: none !important; margin: 5px auto; padding: 5px 10px; visibility: hidden !important; opacity: 0 !important; position: relative !important;";
seeLessBtn.addEventListener("click", async () => {
  await fetchYourPosts(true);
});

buttonContainer.appendChild(seeMoreBtn);
buttonContainer.appendChild(seeLessBtn);
yourPostsList.appendChild(buttonContainer);

// Use cached totalYourPosts
if (shownPostIds.size >= totalYourPosts) {
  seeMoreBtn.style.cssText = "display: none !important; margin: 5px auto; padding: 5px 10px; visibility: hidden !important; opacity: 0 !important;";
  seeLessBtn.style.cssText = "display: block !important; margin: 5px auto; padding: 5px 10px; visibility: visible !important; opacity: 1 !important; position: relative !important;";
} else {
  seeMoreBtn.style.cssText = "display: block !important; margin: 5px auto; padding: 5px 10px; visibility: visible !important; opacity: 1 !important; position: relative !important;";
  seeLessBtn.style.cssText = shownPostIds.size > 2 
    ? "display: block !important; margin: 5px auto; padding: 5px 10px; visibility: visible !important; opacity: 1 !important; position: relative !important;" 
    : "display: none !important; margin: 5px auto; padding: 5px 10px; visibility: hidden !important; opacity: 0 !important;";
}
}

await fetchYourPosts();
}

async function savePost(postId, communityId, button) {
console.log(`savePost called for postId: ${postId}`);
const modal = document.getElementById("savePostModal");
const noteInput = document.getElementById("savePostNote");
const confirmBtn = document.getElementById("confirmSavePostBtn");
const cancelBtn = document.getElementById("cancelSavePostBtn");
const user = auth.currentUser;

noteInput.value = "";
modal.style.display = "flex";
modal.classList.remove("hidden");

confirmBtn.dataset.postId = postId;
confirmBtn.dataset.communityId = communityId;

confirmBtn.onclick = async () => {
const note = noteInput.value.trim();
const userRef = doc(db, "users", user.uid);
const savedPostsRef = collection(userRef, "savedPosts");

const existingQ = query(savedPostsRef, where("postId", "==", postId), where("communityId", "==", communityId));
const existingSnapshot = await getDocs(existingQ);
if (!existingSnapshot.empty) {
  alert("You’ve already saved this post!");
  closeModal("savePostModal");
  return;
}

await addDoc(savedPostsRef, {
  postId,
  communityId,
  note: note || "",
  savedAt: new Date()
});

if (button) button.textContent = "Unsave";
alert("Post saved!");
closeModal("savePostModal");
};

cancelBtn.onclick = () => closeModal("savePostModal");
}

async function deleteSavedPostFromPost(postId, communityId, button) {
console.log(`deleteSavedPostFromPost called for postId: ${postId}`);
const user = auth.currentUser;
const userRef = doc(db, "users", user.uid);
const savedPostsQ = query(
collection(userRef, "savedPosts"),
where("postId", "==", postId),
where("communityId", "==", communityId)
);
const savedPostsSnapshot = await getDocs(savedPostsQ);

if (savedPostsSnapshot.empty) {
console.log(`Post ${postId} not found in savedPosts`);
alert("Post already unsaved!");
if (button) button.textContent = "Save";
return;
}

if (confirm("Are you sure you want to unsave this post?")) {
const savedDoc = savedPostsSnapshot.docs[0];
await deleteDoc(doc(db, "users", user.uid, "savedPosts", savedDoc.id));
if (button) button.textContent = "Save";
alert("Post unsaved!");
}
}

async function viewSavedPosts(userId) {
const modal = document.getElementById("viewSavedPostsModal");
const savedPostsList = document.getElementById("savedPostsList");
const closeBtn = document.getElementById("closeSavedPostsBtn");

// Safety checks for Firebase imports
if (typeof doc !== "function" || !db) {
console.error("Firebase setup issue - doc:", doc, "db:", db);
savedPostsList.innerHTML = "<p class='error-message'>Error: Couldn’t load saved posts. Try refreshing.</p>";
modal.style.display = "flex";
modal.classList.remove("hidden");
closeBtn.onclick = () => closeModal("viewSavedPostsModal");
return;
}

savedPostsList.innerHTML = '<div class="loading">⏳ Loading...</div>';
modal.style.display = "flex";
modal.classList.remove("hidden");

try {
const userRef = doc(db, "users", userId);
const savedPostsQ = query(collection(userRef, "savedPosts"), orderBy("savedAt", "desc"));
const savedPostsSnapshot = await getDocs(savedPostsQ);

// Clear and set up grid container
savedPostsList.innerHTML = "";
savedPostsList.classList.add("saved-posts-grid");

if (savedPostsSnapshot.empty) {
  savedPostsList.innerHTML = "<p class='no-posts-message'>No saved posts yet!</p>";
} else {
  for (const savedDoc of savedPostsSnapshot.docs) {
    const savedData = savedDoc.data();
    let postData = null;
    let userData = { name: "Unknown" };
    let communityName = "Unknown Community";

    try {
      const postRef = doc(db, "communities", savedData.communityId, "posts", savedData.postId);
      const postDoc = await getDoc(postRef);
      postData = postDoc.exists() ? postDoc.data() : null;
      if (postData) {
        userData = await fetchUserData(postData.userId || "unknown");
      }
    } catch (error) {
      console.warn(`Failed to fetch post ${savedData.postId}:`, error);
    }

    try {
      const commRef = doc(db, "communities", savedData.communityId);
      const commDoc = await getDoc(commRef);
      communityName = commDoc.exists() ? commDoc.data().name || "Unnamed Community" : "Unknown Community";
    } catch (error) {
      console.warn(`Failed to fetch community ${savedData.communityId}:`, error);
    }

    const postCard = document.createElement("div");
    postCard.className = "saved-post-card";
    postCard.dataset.docId = savedDoc.id; // For easy removal
    postCard.innerHTML = `
      <div class="post-card-content">
        <h3>${postData ? postData.title : "Post Deleted"}</h3>
        <p>By: ${userData.name}</p>
        <p>Post ID: <span class="copyable-post-id clickable" data-post-id="${savedData.postId}">${savedData.postId}</span></p>
        <p>Community: <a href="./community.html?id=${savedData.communityId}">${communityName}</a></p>
        <p class="saved-note">Note: <span data-doc-id="${savedDoc.id}">${savedData.note || "No note"}</span></p>
        <div class="post-card-actions">
          <button class="edit-note-btn" data-doc-id="${savedDoc.id}">✏️ Edit Note</button>
          <button class="delete-saved-btn" data-doc-id="${savedDoc.id}">🗑️ Unsave</button>
        </div>
      </div>
    `;
    savedPostsList.appendChild(postCard);

    // Fade in animation
    postCard.style.opacity = "0";
    setTimeout(() => {
      postCard.style.transition = "opacity 0.3s ease";
      postCard.style.opacity = "1";
    }, 50);

    // Event listeners
    postCard.querySelector(`.copyable-post-id[data-post-id="${savedData.postId}"]`).addEventListener("click", () => {
      navigator.clipboard.writeText(savedData.postId).then(() => alert("Post ID copied!")).catch(err => console.error("Copy failed:", err));
    });
    postCard.querySelector(`.edit-note-btn[data-doc-id="${savedDoc.id}"]`).addEventListener("click", () => editSavedNote(savedDoc.id, savedData.note));
    postCard.querySelector(`.delete-saved-btn[data-doc-id="${savedDoc.id}"]`).addEventListener("click", () => deleteSavedPost(savedDoc.id, userId));
  }
}
} catch (error) {
console.error("Error loading saved posts:", error);
savedPostsList.innerHTML = "<p class='error-message'>Oops, something went wrong. Try again later.</p>";
}

closeBtn.onclick = () => closeModal("viewSavedPostsModal");
}

async function editSavedNote(docId, currentNote) {
const modal = document.getElementById("savePostModal");
const noteInput = document.getElementById("savePostNote");
const confirmBtn = document.getElementById("confirmSavePostBtn");
const cancelBtn = document.getElementById("cancelSavePostBtn");

modal.querySelector("h2").textContent = "Edit Note";
noteInput.value = currentNote;
modal.style.display = "flex";
modal.classList.remove("hidden");

confirmBtn.onclick = async () => {
const newNote = noteInput.value.trim();
const user = auth.currentUser;
const savedPostRef = doc(db, "users", user.uid, "savedPosts", docId);

try {
  await updateDoc(savedPostRef, { note: newNote || "" });
  document.querySelector(`.saved-note[data-doc-id="${docId}"]`).textContent = newNote || "No note";
  closeModal("savePostModal");
  modal.querySelector("h2").textContent = "Save Post";
} catch (error) {
  console.error("Error updating note:", error);
  alert("Failed to update note. Try again.");
}
};

cancelBtn.onclick = () => {
closeModal("savePostModal");
modal.querySelector("h2").textContent = "Save Post";
};
}

async function deleteSavedPost(docId, userId) {
if (confirm("Are you sure you want to unsave this post?")) {
const user = auth.currentUser;
const savedPostRef = doc(db, "users", user.uid, "savedPosts", docId);
const savedPostsList = document.getElementById("savedPostsList");
const postCard = savedPostsList.querySelector(`.saved-post-card[data-doc-id="${docId}"]`);

try {
  // Fade out before deleting
  if (postCard) {
    postCard.style.transition = "opacity 0.3s ease";
    postCard.style.opacity = "0";
    await new Promise(resolve => setTimeout(resolve, 300)); // Wait for fade-out
  }

  await deleteDoc(savedPostRef);

  if (postCard) postCard.remove();
  if (!savedPostsList.querySelector(".saved-post-card")) {
    savedPostsList.innerHTML = "<p class='no-posts-message'>No saved posts yet!</p>";
  }

  alert("Post unsaved!");
} catch (error) {
  console.error("Error deleting saved post:", error);
  if (postCard) postCard.style.opacity = "1"; // Restore if failed
  alert("Failed to unsave post. Try again.");
}
}
}

//There is a deployed Cloud Function for keeping postCount live "onPostChange"
async function getTotalPosts(communityId) {
const commRef = doc(db, "communities", communityId);
const commDoc = await getDoc(commRef);
const commData = commDoc.data();
return commData.postCount || 0; // Fallback to 0 if not set yet
}

async function searchPostsById(postId) {
const postsDiv = document.getElementById("postList");
const caughtUpDiv = document.getElementById("caughtUpMessage");
postsDiv.innerHTML = '<div class="loading">⏳ Searching...</div>';
caughtUpDiv.style.display = "none";

if (!postId || postId.trim() === "") {
isSearching = false;
postsDiv.innerHTML = "";
await loadPosts(communityId, true); // Reset to full list
return;
}

isSearching = true; // Set flag to pause scrolldown

try {
// Check cache first to avoid unnecessary reads
const cachedPosts = getCachedPosts();
const cachedPost = cachedPosts.get(postId.trim());
let post, actualPostId, userData, reportStatus, commentCount;

if (cachedPost) {
  console.log(`Post ${postId} found in cache—no Firestore read needed.`);
  post = cachedPost.data;
  actualPostId = postId.trim();
  userData = await fetchUserData(post.userId || "unknown");
  reportStatus = await getPostReportStatus(actualPostId);
  const commentsQ = query(collection(db, "communities", communityId, "posts", actualPostId, "comments"));
  const commentsSnapshot = await getDocs(commentsQ);
  commentCount = commentsSnapshot.size;
} else {
  // Fetch from Firestore if not cached
  console.log(`Post ${postId} not in cache—fetching from Firestore.`);
  const q = query(
    collection(db, "communities", communityId, "posts"),
    where("__name__", "==", postId.trim())
  );
  const snapshot = await getDocs(q);
  postsDiv.innerHTML = "";

  if (snapshot.empty) {
    postsDiv.innerHTML = `<p>No post found with ID: ${postId}</p>`;
    return;
  }

  const doc = snapshot.docs[0];
  post = normalizePostData(doc.data()); // Normalize for consistency
  actualPostId = doc.id;
  userData = await fetchUserData(post.userId || "unknown");

  // Cache the fetched post
  cachedPosts.set(actualPostId, { id: actualPostId, data: post, score: getPostScore(post, getLikedPrefs()) });
  setCachedPosts(cachedPosts);

  reportStatus = await getPostReportStatus(actualPostId);
  const commentsQ = query(collection(db, "communities", communityId, "posts", actualPostId, "comments"));
  const commentsSnapshot = await getDocs(commentsQ);
  commentCount = commentsSnapshot.size;
}

const currentUser = auth.currentUser;
const commData = await getCommData();
const isAdmin = commData?.admins?.includes(currentUser.uid) || commData?.creatorId === currentUser.uid;
const isOwner = post.userId === currentUser.uid;

if (reportStatus.isHidden && !isAdmin && !isOwner) {
  postsDiv.innerHTML = `<p>Post ID ${postId} is hidden due to reports (visible to admins/owner only).</p>`;
  return;
}

const timestamp = post.createdAt ? new Date(post.createdAt).toLocaleString() : "N/A";
const photoUrls = post.photoUrls || [];
const photoCount = photoUrls.length;

// Add the message and button above the post
postsDiv.innerHTML = `
  <div id="searchMessage" class="search-message">
    <p>Showing post with ID: ${actualPostId}. <button id="showAllPostsBtn">Click here to see all posts again</button></p>
  </div>
  <div class="post" id="post-${actualPostId}">
    <h3>${post.title || "No Title"}</h3>
    <p class="post-description">${post.description || "No Description"}</p>
    <div class="photo-carousel" id="carousel-${actualPostId}-search" data-photos='${JSON.stringify(photoUrls)}'>
      ${photoCount > 1 ? `<button class="carousel-prev" data-post-id="${actualPostId}-search"><</button>` : ""}
      <img loading="lazy" src="${photoUrls[0] || 'https://firebasestorage.googleapis.com/v0/b/life-swap-6065e.firebasestorage.app/o/static%2Fno-image.webp?alt=media&token=6a974dce-aa63-4d94-b889-a86f626fb430'}" alt="Post photo" class="carousel-image">
      ${photoCount > 1 ? `<button class="carousel-next" data-post-id="${actualPostId}-search">></button>` : ""}
    </div>
    <p>By: <span class="username" data-uid="${post.userId || 'unknown'}">${userData.name || "Unknown"} (${userData.username || "unknown"})</span></p>
    <p>Location: ${post.location?.name || "N/A"}</p>
    <p>Category: ${post.category || "N/A"}</p>
    <p class="highlight">Looking For: ${post.lookingFor || "N/A"} | Offering: ${post.offering || "N/A"}</p>
    <p>Posted: ${timestamp}</p>
    <p>Post ID: ${actualPostId} <button class="copy-btn" data-post-id="${actualPostId}">Copy</button></p>
    <button class="like-btn" data-post-id="${actualPostId}">${(post.likedBy || []).includes(currentUser.uid) ? '💔 Unlike' : '❤️ Like'} (${post.likes || 0})</button>
    <button class="report-btn" id="reportPost-${actualPostId}">Report Post</button>
    <br><br>
    ${(isOwner || isAdmin) ? `<button class="delete-btn" id="deletePost-${actualPostId}">Delete Post</button>` : ""}
    ${reportStatus.isOwner && reportStatus.reportCount === 1 ? `
      <div class="report-warning" id="warning-${actualPostId}">
        This post has 1 report. One more will hide it—check summary!
      </div>` : ""}
    ${reportStatus.isOwner && reportStatus.reportCount >= 2 ? `
      <div class="report-warning" id="warning-${actualPostId}">
        This post has ${reportStatus.reportCount} reports and is hidden. Appeal above!
      </div>` : ""}
    ${isAdmin && reportStatus.reportCount > 0 ? `
      <div class="admin-report-controls" id="admin-controls-${actualPostId}">
        This post received ${reportStatus.reportCount} report${reportStatus.reportCount > 1 ? 's' : ''}.
        <button class="remove-post-btn" data-post-id="${actualPostId}">Remove Post</button>
        <button class="clear-reports-btn" data-post-id="${actualPostId}">Clear Reports</button>
      </div>` : ""}
    <div class="comments-section">
      <a href="#" class="comment-count" id="toggleComments-${actualPostId}">${commentCount} comments</a>
      <div class="comments-thread" id="comments-${actualPostId}" style="display: none;"></div>
      <form id="commentForm-${actualPostId}" class="comment-form">
        <textarea placeholder="Add a comment..." required></textarea>
        <button type="submit">Comment</button>
      </form>
    </div>
  </div>
`;

// Add event listener for the "Show All Posts" button
const showAllPostsBtn = postsDiv.querySelector("#showAllPostsBtn");
if (showAllPostsBtn) {
  showAllPostsBtn.addEventListener("click", async () => {
    const searchInput = document.getElementById("postSearch");
    if (searchInput) searchInput.value = ""; // Clear the search input
    isSearching = false;
    postsDiv.innerHTML = ""; // Clear current content
    await loadPosts(communityId, true); // Reload all posts
  });
}

const postDiv = postsDiv.querySelector(`#post-${actualPostId}`);
postDiv.querySelector(`.username[data-uid="${post.userId || 'unknown'}"]`).addEventListener("click", () => viewProfile(post.userId || "unknown"));
postDiv.querySelector(`.copy-btn[data-post-id="${actualPostId}"]`).addEventListener("click", (e) => {
  e.stopPropagation();
  copyPostId(actualPostId);
});
postDiv.querySelector(`#reportPost-${actualPostId}`).addEventListener("click", () => reportPost(actualPostId));
const deleteBtn = postDiv.querySelector(`#deletePost-${actualPostId}`);
if (deleteBtn) deleteBtn.addEventListener("click", () => deletePost(actualPostId));
if (isAdmin) {
  postDiv.querySelector(`.remove-post-btn[data-post-id="${actualPostId}"]`)?.addEventListener("click", () => deletePost(actualPostId));
  postDiv.querySelector(`.clear-reports-btn[data-post-id="${actualPostId}"]`)?.addEventListener("click", () => clearReports(actualPostId));
}
postDiv.querySelector(`#toggleComments-${actualPostId}`).addEventListener("click", (e) => {
  e.preventDefault();
  toggleComments(actualPostId);
});
postDiv.querySelector(`#commentForm-${actualPostId}`).addEventListener("submit", (e) => {
  e.preventDefault();
  addComment(actualPostId, post.userId);
});

// Like/Unlike button logic
const likeBtn = postDiv.querySelector(`.like-btn[data-post-id="${actualPostId}"]`);
likeBtn.addEventListener("click", async () => {
  const postRef = doc(db, "communities", communityId, "posts", actualPostId);
  const postSnapshot = await getDoc(postRef);

  if (!postSnapshot.exists()) {
    alert("Post not found—might’ve been deleted!");
    return;
  }

  const postData = normalizePostData(postSnapshot.data());
  const userId = auth.currentUser.uid;
  const likedBy = postData.likedBy || [];
  let newLikes = postData.likes || 0;
  let newLikedBy = [...likedBy];

  if (likedBy.includes(userId)) {
    newLikedBy = newLikedBy.filter(id => id !== userId);
    newLikes = Math.max(0, newLikes - 1);
    await updateDoc(postRef, {
      likes: newLikes,
      likedBy: newLikedBy
    });
    likeBtn.textContent = `Like (${newLikes})`;
  } else {
    newLikedBy.push(userId);
    newLikes += 1;
    await updateDoc(postRef, {
      likes: newLikes,
      likedBy: newLikedBy
    });
    likeBtn.textContent = `💔 Unlike (${newLikes})`;
    addLikedPref(postData.category, postData.offering); // Track prefs on like
  }

  // Update cached post
  cachedPosts.set(actualPostId, { 
    id: actualPostId, 
    data: { ...postData, likes: newLikes, likedBy: newLikedBy }, 
    score: getPostScore({ ...postData, likes: newLikes, likedBy: newLikedBy }, getLikedPrefs()) 
  });
  setCachedPosts(cachedPosts);
});

if (photoCount > 1) setupSearchCarousel(actualPostId);

} catch (error) {
console.error("Search error:", error);
postsDiv.innerHTML = "<p>Something went wrong, try again!</p>";
} finally {
isSearching = false; // Reset flag
}
}

// Keep this helper as is—it’s solid for the carousel
function setupSearchCarousel(postId) {
const carousel = document.getElementById(`carousel-${postId}-search`);
const prevBtn = carousel.querySelector(`.carousel-prev[data-post-id="${postId}-search"]`);
const nextBtn = carousel.querySelector(`.carousel-next[data-post-id="${postId}-search"]`);
const img = carousel.querySelector(".carousel-image");
let photoUrls = JSON.parse(carousel.dataset.photos || "[]");
let currentIndex = 0;

if (!prevBtn || !nextBtn || !img) return;

if (photoUrls.length === 0) {
photoUrls = ["https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y"];
}

img.src = photoUrls[0];

prevBtn.addEventListener("click", (e) => {
e.preventDefault();
currentIndex = (currentIndex - 1 + photoUrls.length) % photoUrls.length;
img.src = photoUrls[currentIndex];
});

nextBtn.addEventListener("click", (e) => {
e.preventDefault();
currentIndex = (currentIndex + 1) % photoUrls.length;
img.src = photoUrls[currentIndex];
});
}



async function acceptProfileRequest(requestId, userId) {
const requestRef = doc(db, "users", userId, "profileRequests", requestId);
const requestDoc = await getDoc(requestRef);
const requesterId = requestDoc.data().requesterId;
const targetData = await fetchCurrentUserData(); // Get the accepter’s name

await updateDoc(requestRef, { status: "accepted" });

// Send notification to requester
await addDoc(collection(db, "users", requesterId, "notifications"), {
type: "profile_request_accepted",
message: `${targetData.name || "Someone"} accepted your profile view request!`,
requestId: requestId,
timestamp: new Date(),
seen: false
});

// Increment requester’s unseenCount
const requesterRef = doc(db, "users", requesterId);
await runTransaction(db, async (transaction) => {
const requesterDoc = await transaction.get(requesterRef);
const currentCount = requesterDoc.exists() ? requesterDoc.data().unseenCount || 0 : 0;
transaction.set(requesterRef, { unseenCount: currentCount + 1, lastUpdated: new Date() }, { merge: true });
console.log(`Client: Incremented unseenCount for ${requesterId} to ${currentCount + 1}`);
});

alert("Profile view request accepted!");
closeModal("viewProfileViewRequestsModal");
await updateProfileRequestsUI(userId);
viewProfileViewRequests(userId);
setTimeout(() => updateNotificationBadge(requesterId, true), 1000);
}

async function declineProfileRequest(requestId, userId) {
const requestRef = doc(db, "users", userId, "profileRequests", requestId);
const requestDoc = await getDoc(requestRef);
const requesterId = requestDoc.data().requesterId;
const targetData = await fetchCurrentUserData(); // Get the decliner’s name

await deleteDoc(requestRef);

// Send notification to requester
await addDoc(collection(db, "users", requesterId, "notifications"), {
type: "profile_request_declined",
message: `${targetData.name || "Someone"} declined your profile view request.`,
requestId: requestId,
timestamp: new Date(),
seen: false
});

// Increment requester’s unseenCount
const requesterRef = doc(db, "users", requesterId);
await runTransaction(db, async (transaction) => {
const requesterDoc = await transaction.get(requesterRef);
const currentCount = requesterDoc.exists() ? requesterDoc.data().unseenCount || 0 : 0;
transaction.set(requesterRef, { unseenCount: currentCount + 1, lastUpdated: new Date() }, { merge: true });
console.log(`Client: Incremented unseenCount for ${requesterId} to ${currentCount + 1}`);
});

alert("Profile view request declined!");
closeModal("viewProfileViewRequestsModal");
await updateProfileRequestsUI(userId);
viewProfileViewRequests(userId);
setTimeout(() => updateNotificationBadge(requesterId, true), 1000);
}

async function revokeProfileAccess(targetId, requestId) {
const requestRef = doc(db, "users", targetId, "profileRequests", requestId);
await deleteDoc(requestRef); // Deletes the doc—clean!
alert("Profile access revoked!");
closeModal("viewProfileModal");
await viewProfile(targetId); // Reopens with fresh state
}

async function revokeProfileAccessFromModal(requestId, userId) {
const requestRef = doc(db, "users", userId, "profileRequests", requestId);
await deleteDoc(requestRef); // Deletes the doc—clean!
alert("Profile access revoked!");
closeModal("viewProfileViewRequestsModal");
await updateProfileRequestsUI(userId);
viewProfileViewRequests(userId); // Refreshes the requests modal
}

async function viewProfileViewRequests(userId) {
const modal = document.getElementById("viewProfileViewRequestsModal");
const requestsList = document.getElementById("profileViewRequestsList");
const grantedList = document.getElementById("grantedProfileAccessList");

// Subcollection queries for the user’s profile requests
const requestsRef = collection(db, "users", userId, "profileRequests");
const pendingQ = query(requestsRef, where("status", "==", "pending"));
const pendingSnapshot = await getDocs(pendingQ);
requestsList.innerHTML = pendingSnapshot.empty ? "<p>No pending profile view requests.</p>" : "";

for (const doc of pendingSnapshot.docs) {
const request = doc.data();
const requesterData = await fetchUserData(request.requesterId);
requestsList.innerHTML += `
  <div class="request-item" id="request-${doc.id}">
    <span>${requesterData.name} (${requesterData.username})</span>
    <button class="accept-btn" data-request-id="${doc.id}">Accept</button>
    <button class="decline-btn" data-request-id="${doc.id}">Decline</button>
  </div>
`;
}

const grantedQ = query(requestsRef, where("status", "==", "accepted"));
const grantedSnapshot = await getDocs(grantedQ);
grantedList.innerHTML = grantedSnapshot.empty ? "<p>No granted profile access.</p>" : "";

for (const doc of grantedSnapshot.docs) {
const request = doc.data();
const requesterData = await fetchUserData(request.requesterId);
grantedList.innerHTML += `
  <div class="request-item" id="granted-${doc.id}">
    <span>${requesterData.name} (${requesterData.username})</span>
    <button class="revoke-btn" data-request-id="${doc.id}">Revoke</button>
  </div>
`;
}

// Show the modal
document.querySelectorAll(".modal:not(#viewProfileViewRequestsModal)").forEach(m => m.style.display = "none");
modal.style.display = "flex";
modal.classList.remove("hidden");

// Attach event listeners
requestsList.querySelectorAll(".accept-btn").forEach(btn => {
btn.addEventListener("click", () => acceptProfileRequest(btn.dataset.requestId, userId));
});
requestsList.querySelectorAll(".decline-btn").forEach(btn => {
btn.addEventListener("click", () => declineProfileRequest(btn.dataset.requestId, userId));
});
grantedList.querySelectorAll(".revoke-btn").forEach(btn => {
btn.addEventListener("click", () => revokeProfileAccessFromModal(btn.dataset.requestId, userId));
});
}

let currentMembers = []; // Still used for search, but populated differently

async function viewMembers(communityId) {
const modal = document.getElementById("viewMembersModal");
const membersList = document.getElementById("membersList");
const memberSearch = document.getElementById("memberSearch");

if (!modal || !membersList || !memberSearch) {
console.error("Members modal elements missing!");
return;
}

lastMemberDoc = null;
membersList.innerHTML = '<div class="loading">⏳ Loading...</div>';
modal.style.display = "flex";
modal.classList.remove("hidden");

const commData = await getCommData(); // Get memberCount from cache
const totalMembers = commData.memberCount || 0; // Use precomputed count
console.log("Total members from memberCount:", totalMembers);

// Update modal header with total members
const header = modal.querySelector("h2") || document.createElement("h2");
if (!modal.querySelector("h2")) modal.querySelector(".modal-content").prepend(header);
header.textContent = `Members (Total: ${totalMembers})`;

const membersRef = collection(db, "communities", communityId, "members");
const q = query(membersRef, limit(ITEMS_PER_PAGE));
let snapshot;
try {
snapshot = await getDocs(q);
} catch (error) {
console.error("Error fetching initial members:", error);
membersList.innerHTML = "<p>Failed to load members. Try again.</p>";
return;
}
currentMembers = snapshot.docs.map(doc => doc.id);
console.log("Initial members loaded:", currentMembers.length);

await loadMembersBatch(snapshot, true, totalMembers);

memberSearch.oninput = debounce((e) => searchMembers(communityId, e.target.value), 300);
}

async function loadMembersBatch(snapshot, reset = false, totalMembers) {
const membersList = document.getElementById("membersList");

if (reset) {
membersList.innerHTML = "";
lastMemberDoc = null;
}

const startIndex = lastMemberDoc ? membersList.querySelectorAll(".user-item").length : 0;
console.log("Loading batch:", { startIndex, batchSize: snapshot.docs.length });

if (snapshot.empty && startIndex === 0) {
membersList.innerHTML = "<p>No members yet!</p>";
updateMembersButtons(totalMembers, 0);
return;
}

const uids = snapshot.docs.map(doc => doc.id);
let userSnapshot;
try {
const q = query(collection(db, "users"), where("__name__", "in", uids));
userSnapshot = await getDocs(q);
} catch (error) {
console.error("Error fetching user data for members:", error);
membersList.innerHTML += "<p>Failed to load some member data.</p>";
return;
}
console.log("Fetched users:", userSnapshot.docs.length);

userSnapshot.docs.forEach(doc => {
const userData = doc.data();
const itemId = `member-${doc.id}`;
if (!document.getElementById(itemId)) {
  const memberDiv = document.createElement("div");
  memberDiv.className = "user-item";
  memberDiv.id = itemId;
  memberDiv.innerHTML = `
    <img loading="lazy" src="${userData.profilePhoto || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'}" alt="Profile">
    <span class="username" data-uid="${doc.id}">${userData.name}</span>
  `;
  membersList.appendChild(memberDiv);
  memberDiv.querySelector(`.username[data-uid="${doc.id}"]`).addEventListener("click", () => viewProfile(doc.id));
}
});

lastMemberDoc = snapshot.docs.length === ITEMS_PER_PAGE ? snapshot.docs[snapshot.docs.length - 1] : null;
const loadedCount = membersList.querySelectorAll(".user-item").length;
console.log("Loaded count:", loadedCount);

updateMembersButtons(totalMembers, loadedCount);
}

function updateMembersButtons(totalMembers, loadedCount) {
const membersList = document.getElementById("membersList");
const existingMoreBtn = membersList.querySelector("#seeMoreMembersBtn");
const existingLessBtn = membersList.querySelector("#seeLessMembersBtn");
if (existingMoreBtn) existingMoreBtn.remove();
if (existingLessBtn) existingLessBtn.remove();

console.log("Updating buttons:", { totalMembers, loadedCount });

if (totalMembers > 0) {
const seeMore = document.createElement("button");
seeMore.id = "seeMoreMembersBtn";
seeMore.textContent = "See More";
seeMore.className = "see-more-btn";
seeMore.style.display = totalMembers > loadedCount ? "block" : "none";
seeMore.onclick = async () => {
  const membersRef = collection(db, "communities", communityId, "members"); // Ensure communityId is in scope
  try {
    const q = query(membersRef, startAfter(lastMemberDoc), limit(ITEMS_PER_PAGE));
    const nextSnapshot = await getDocs(q);
    currentMembers = currentMembers.concat(nextSnapshot.docs.map(doc => doc.id));
    await loadMembersBatch(nextSnapshot, false, totalMembers);
  } catch (error) {
    console.error("Error loading more members:", error);
    membersList.innerHTML += "<p>Failed to load more members.</p>";
  }
};

const seeLess = document.createElement("button");
seeLess.id = "seeLessMembersBtn";
seeLess.textContent = "See Less";
seeLess.className = "see-less-btn";
seeLess.style.display = loadedCount > ITEMS_PER_PAGE ? "block" : "none";
seeLess.onclick = () => loadMembersBatch([], true, totalMembers);

membersList.appendChild(seeMore);
membersList.appendChild(seeLess);

console.log("See More display:", seeMore.style.display);
}
}

async function searchMembers(communityId, searchTerm) {
const membersList = document.getElementById("membersList");
let startIndex = 0;

membersList.innerHTML = '<div class="loading">⏳ Searching...</div>';

if (!searchTerm) {
lastMemberDoc = null;
return viewMembers(communityId);
}

const membersRef = collection(db, "communities", communityId, "members");
let allMembersSnapshot;
try {
allMembersSnapshot = await getDocs(membersRef);
} catch (error) {
console.error("Error fetching all members for search:", error);
membersList.innerHTML = "<p>Failed to search members.</p>";
return;
}
const allMembers = allMembersSnapshot.docs.map(doc => doc.id);

const filteredMembers = [];
for (const uid of allMembers) {
const userData = userDataCache[uid] || (await fetchUserData(uid));
if (userData && (
  userData.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
  userData.username.toLowerCase().includes(searchTerm.toLowerCase())
)) {
  filteredMembers.push(uid);
}
}
console.log(`Search filtered members: ${filteredMembers.length} matches for "${searchTerm}"`);

async function loadSearchBatch(reset = false) {
if (reset) {
  startIndex = 0;
  membersList.innerHTML = "";
}

const batch = filteredMembers.slice(startIndex, startIndex + ITEMS_PER_PAGE);
console.log(`Loading search batch: startIndex=${startIndex}, batchSize=${batch.length}`);

if (batch.length === 0) {
  if (startIndex === 0) {
    membersList.innerHTML = "<p>No matching members found.</p>";
  }
  updateSearchButtons(filteredMembers.length, startIndex);
  return;
}

let snapshot;
try {
  const q = query(collection(db, "users"), where("__name__", "in", batch));
  snapshot = await getDocs(q);
} catch (error) {
  console.error("Error fetching search batch:", error);
  membersList.innerHTML += "<p>Failed to load some members.</p>";
  return;
}

if (startIndex === 0) membersList.innerHTML = "";
snapshot.docs.forEach(doc => {
  const userData = doc.data();
  const itemId = `member-${doc.id}`;
  if (!document.getElementById(itemId)) {
    const memberDiv = document.createElement("div");
    memberDiv.className = "user-item";
    memberDiv.id = itemId;
    memberDiv.innerHTML = `
      <img loading="lazy" src="${userData.profilePhoto || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'}" alt="Profile">
      <span class="username" data-uid="${doc.id}">${userData.name}</span>
    `;
    membersList.appendChild(memberDiv);
    memberDiv.querySelector(`.username[data-uid="${doc.id}"]`).addEventListener("click", () => viewProfile(doc.id));
  }
});

const loadedCount = membersList.querySelectorAll(".user-item").length;
updateSearchButtons(filteredMembers.length, loadedCount);
}

function updateSearchButtons(totalFiltered, loadedCount) {
const existingMoreBtn = membersList.querySelector("#seeMoreSearchMembersBtn");
const existingLessBtn = membersList.querySelector("#seeLessSearchMembersBtn");
if (existingMoreBtn) existingMoreBtn.remove();
if (existingLessBtn) existingLessBtn.remove();

console.log(`Search buttons: totalFiltered=${totalFiltered}, loadedCount=${loadedCount}`);

if (totalFiltered > 0) {
  const seeMore = document.createElement("button");
  seeMore.id = "seeMoreSearchMembersBtn";
  seeMore.textContent = "See More";
  seeMore.className = "see-more-btn";
  seeMore.style.display = totalFiltered > loadedCount ? "block" : "none";
  seeMore.onclick = () => {
    startIndex += ITEMS_PER_PAGE;
    loadSearchBatch();
  };

  const seeLess = document.createElement("button");
  seeLess.id = "seeLessSearchMembersBtn";
  seeLess.textContent = "See Less";
  seeLess.className = "see-less-btn";
  seeLess.style.display = loadedCount > ITEMS_PER_PAGE ? "block" : "none";
  seeLess.onclick = () => loadSearchBatch(true);

  membersList.appendChild(seeMore);
  membersList.appendChild(seeLess);
}
}

await loadSearchBatch(true);

}

async function viewCommunities(userId) {
const modal = document.getElementById("viewCommunitiesModal");
const communitiesList = document.getElementById("communitiesList");
const closeBtn = document.getElementById("closeCommunitiesBtn");

communitiesList.innerHTML = '<div class="loading">⏳ Loading...</div>';
modal.style.display = "flex";
modal.classList.remove("hidden");

const userRef = doc(db, "users", userId);
const userDoc = await getDoc(userRef);
const communityIds = userDoc.data().communityIds || [];

if (communityIds.length === 0) {
communitiesList.innerHTML = "<p>You’re not in any communities yet!</p>";
} else {
communitiesList.innerHTML = "";
const commPromises = communityIds.map(id => getDoc(doc(db, "communities", id)));
const commDocs = await Promise.all(commPromises);

commDocs.forEach(doc => {
  if (doc.exists()) {
    const commData = doc.data();
    const isBanned = (commData.bannedUsers || []).includes(userId);
    if (!isBanned) { // Only show if not banned
      const commDiv = document.createElement("div");
      commDiv.className = "community-item";
      commDiv.innerHTML = `
        <a href="./community.html?id=${doc.id}">${commData.name || "Unnamed"}</a>
      `;
      communitiesList.appendChild(commDiv);
    }
  }
});

if (!communitiesList.children.length) {
  communitiesList.innerHTML = "<p>No active communities found.</p>";
}
}

closeBtn.onclick = () => {
modal.style.display = "none";
modal.classList.add("hidden");
};
}

// Get unseen notification count from user doc
async function getUnseenNotificationCount(userId, forceRefresh = false) {
const now = Date.now();
const CACHE_KEY = `unseenNotifCount_${userId}`;
const TTL = 60 * 60 * 1000; // 1 hour
const cachedData = JSON.parse(localStorage.getItem(CACHE_KEY)) || { count: 0, timestamp: 0 };

if (!forceRefresh && cachedData.timestamp && (now - cachedData.timestamp < TTL)) {
console.log(`Using cached unseen count: ${cachedData.count} (age: ${Math.round((now - cachedData.timestamp) / 1000)}s)`);
return cachedData.count;
}

console.log("Fetching fresh unseen notification count...");
const userRef = doc(db, "users", userId);
try {
const userDoc = await getDoc(userRef);
if (!userDoc.exists()) throw new Error("User not found");
const newCount = userDoc.data().unseenCount || 0;
localStorage.setItem(CACHE_KEY, JSON.stringify({ count: newCount, timestamp: now }));
console.log(`Fetched unseen count: ${newCount}`);
return newCount;
} catch (error) {
console.error("Error fetching unseen count:", error);
return cachedData.count; // Fallback to cache
}
}

// Update badge with unseen count

//This make the chat.js works 
window.updateNotificationBadge = updateNotificationBadge;

async function updateNotificationBadge(userId, forceRefresh = true) {
const count = await getUnseenNotificationCount(userId, forceRefresh);
const badge = document.getElementById("notificationCount");
if (badge) {
badge.textContent = count > 0 ? `(${count})` : "";
badge.style.display = count > 0 ? "inline" : "none";
console.log(`Badge updated to: ${count}`);
}
return count;
}

// Force refresh on page load
document.addEventListener("DOMContentLoaded", async () => {
const user = auth.currentUser;
if (user) {
await updateNotificationBadge(user.uid, true);
}
});

// Open notifications modal
async function openNotificationsModal(userId) {
const modal = document.getElementById("notificationsModal");
const notificationList = document.getElementById("notificationList");
const modalCount = document.getElementById("modalNotificationCount");
const communityFilter = document.getElementById("communityFilter");

if (!modal || !notificationList || !modalCount || !communityFilter) {
console.error("Notifications modal elements missing from DOM!");
alert("Something’s broken—refresh the page!");
return;
}

let refreshBtn = modal.querySelector("#refreshNotificationsBtn");
if (!refreshBtn) {
refreshBtn = document.createElement("button");
refreshBtn.id = "refreshNotificationsBtn";
refreshBtn.textContent = "Refresh";
refreshBtn.style.marginLeft = "10px";
modal.querySelector(".modal-content").insertBefore(refreshBtn, document.getElementById("clearNotificationsBtn"));
}

notificationList.innerHTML = '<div class="loading">⏳ Loading...</div>';
modal.style.display = "flex";
modal.classList.remove("hidden");

const userRef = doc(db, "users", userId);
let communities = [];
try {
const userDoc = await getDoc(userRef);
if (!userDoc.exists()) throw new Error("User not found");
const communityIds = userDoc.data().communityIds || [];
const communityDocs = await Promise.all(communityIds.map(id => getDoc(doc(db, "communities", id))));
communities = communityDocs
  .filter(doc => doc.exists())
  .map(doc => ({ id: doc.id, name: doc.data().name || "Unnamed Community" }));
} catch (error) {
console.error("Error fetching communities:", error);
notificationList.innerHTML = "<p>Failed to load communities. Try refreshing.</p>";
return;
}

communityFilter.innerHTML = '<option value="all">All Communities</option>';
communities.forEach(comm => {
const option = document.createElement("option");
option.value = comm.id;
option.textContent = comm.name;
communityFilter.appendChild(option);
});

const ITEMS_PER_PAGE = 10;

const initialCount = await updateNotificationBadge(userId, false);
modalCount.textContent = initialCount;

async function handleViewChatsClick() {
console.log("handleViewChatsClick triggered with userId:", userId, "communityId:", communityId);
await updateChatBadge(userId, true); // Clear unread
await window.viewChats(communityId); // Open modal
await updateChatBadge(userId); // Refresh badge UI
}

async function loadNotifications(reset = false, forceRefresh = false) {
const selectedCommunity = communityFilter.value;
if (reset) {
  lastDoc = null;
  displayedCount = 0;
  allNotifications = [];
  notificationList.innerHTML = '<div class="loading">⏳ Loading...</div>';
}

let retries = 3;
while (retries > 0) {
  try {
    const notifsCollection = collection(db, "users", userId, "notifications");
    let q;
    if (selectedCommunity === "all") {
      q = query(
        notifsCollection,
        orderBy("timestamp", "desc"),
        ...(lastDoc && !reset ? [startAfter(lastDoc)] : []),
        limit(ITEMS_PER_PAGE)
      );
    } else {
      q = query(
        notifsCollection,
        where("communityId", "==", selectedCommunity),
        orderBy("timestamp", "desc"),
        ...(lastDoc && !reset ? [startAfter(lastDoc)] : []),
        limit(ITEMS_PER_PAGE)
      );
    }

    const snapshot = await getDocs(q);
    const newNotifications = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));

    if (forceRefresh) {
      newNotifications.forEach(notif => {
        if (!allNotifications.some(n => n.id === notif.id)) {
          allNotifications.unshift(notif);
        }
      });
    } else {
      newNotifications.forEach(notif => {
        if (!allNotifications.some(n => n.id === notif.id)) {
          allNotifications.push(notif);
        }
      });
      lastDoc = snapshot.docs.length === ITEMS_PER_PAGE ? snapshot.docs[snapshot.docs.length - 1] : null;
    }

    allNotifications.sort((a, b) => b.data.timestamp.toDate() - a.data.timestamp.toDate());

    if (allNotifications.length === 0) {
      notificationList.innerHTML = "<p>No notifications yet.</p>";
    } else {
      const startIdx = reset ? 0 : displayedCount;
      const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, allNotifications.length);
      const content = allNotifications
        .slice(0, endIdx)
        .map(notif => renderNotification({ id: notif.id, data: () => notif.data }, communities))
        .join("");
      notificationList.innerHTML = content;
      displayedCount = endIdx;
    }

    const unseenCount = await getUnseenNotificationCount(userId, forceRefresh);
    modalCount.textContent = unseenCount;
    updateLoadButtons();
    attachNotificationListeners();
    break;
  } catch (error) {
    console.error("Error fetching notifications:", error);
    retries--;
    if (retries === 0) {
      notificationList.innerHTML = "<p>Failed to load notifications after retries. Check your connection!</p>";
      updateLoadButtons();
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
}

function renderNotification(doc, communities) {
const notif = doc.data();
const timestamp = new Date(notif.timestamp.toDate()).toLocaleString();
let displayMessage = notif.message || "No message";
if (notif.communityId && notif.type !== "ban_appeal") {
const communityName = communities.find(c => c.id === notif.communityId)?.name || "Unknown Community";
displayMessage += ` (${communityName})`;
}

// Base HTML structure
let html = `
<div class="notification-item ${notif.seen ? 'seen' : ''}" data-id="${doc.id}" data-type="${notif.type}">
`;

// Special handling for "follow" type notifications
if (notif.type === "follow" && notif.followerId) {
html += `
  <span class="clickable-profile" data-uid="${notif.followerId}">${displayMessage}</span>
`;
} else {
html += `<span>${displayMessage}</span>`;
}

// Add timestamp and buttons
html += `
  <span class="timestamp">${timestamp}</span>
  ${notif.postId ? `<button class="copy-id-btn2" data-post-id="${notif.postId}">Copy ID</button>` : ""}
  <button class="mark-seen-btn2" data-id="${doc.id}" ${notif.seen ? 'disabled' : ''}>${notif.seen ? 'Seen' : 'Mark as Seen'}</button>
`;

// Ban appeal form if applicable
if (notif.type === "ban_appeal" && !notif.appealSubmitted) {
html += `
  <form class="ban-appeal-form" data-id="${doc.id}">
    <textarea placeholder="Explain why this ban might be an error..." required></textarea>
    <button type="submit">Send Appeal</button>
  </form>
`;
}

html += `</div>`;
return html;
}

function attachNotificationListeners() {
notificationList.querySelectorAll(".copy-id-btn2").forEach(btn => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    copyPostId(btn.dataset.postId);
  });
});
notificationList.querySelectorAll(".mark-seen-btn2").forEach(btn => {
  if (!btn.disabled) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      markNotificationSeen(btn.dataset.id);
    });
  }
});
notificationList.querySelectorAll(".ban-appeal-form").forEach(form => {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = form.querySelector("textarea").value.trim();
    if (text) {
      const notifId = form.dataset.id;
      const notif = allNotifications.find(n => n.id === notifId).data;
      try {
        const userDoc = await getDoc(doc(db, "users", userId));
        const userData = userDoc.exists() ? userDoc.data() : { username: `user_${userId.slice(0, 8)}` };
        await addDoc(collection(db, "communities", notif.communityId, "banAppeals"), {
          userId: userId,
          username: userData.username,
          message: text,
          timestamp: new Date(),
          notificationId: notifId
        });
        await updateDoc(doc(db, "users", userId, "notifications", notifId), { appealSubmitted: true });
        alert("Appeal sent!");
        await loadNotifications(true);
      } catch (error) {
        console.error("Error submitting appeal:", error);
        alert("Failed to send appeal.");
      }
    }
  });
});
notificationList.querySelectorAll(".notification-item").forEach(item => {
item.addEventListener("click", async (e) => {
  // Prevent triggering item click if a button/form was clicked
  if (e.target.tagName === "BUTTON" || e.target.tagName === "TEXTAREA" || e.target.closest("form")) {
    return;
  }

  const notif = allNotifications.find(n => n.id === item.dataset.id).data;
  const notifType = item.dataset.type;

  if (notifType === "follow" && notif.followerId) {
    closeModal("notificationsModal");
    await viewProfile(notif.followerId);
  } else if (notifType === "profile_request" || notifType === "profile_request_accepted" || notifType === "profile_request_declined") {
    closeModal("notificationsModal");
    await viewProfileViewRequests(userId);
  } else if (notifType === "new_message" || notifType === "chat") {
    console.log("Chat notification clicked, triggering handleViewChatsClick");
    closeModal("notificationsModal");
    await handleViewChatsClick();
  } else if (notif.postId && notif.communityId) {
    if (notif.communityId !== communityId) {
      window.location.href = `/community.html?id=${notif.communityId}#post-${notif.postId}`;
    } else {
      closeModal("notificationsModal");
      await searchPostsById(notif.postId);
      const scrollTarget = document.getElementById("search-scrolldown");
      if (scrollTarget) {
        scrollTarget.scrollIntoView({ behavior: "smooth" });
      } else {
        console.warn("Scroll target #search-scrolldown not found!");
      }
    }
  }
});
});

// Add listener for clickable profiles
notificationList.querySelectorAll(".clickable-profile").forEach(span => {
span.addEventListener("click", async (e) => {
  e.stopPropagation(); // Prevent triggering the parent .notification-item click
  const uid = span.dataset.uid;
  closeModal("notificationsModal");
  await viewProfile(uid);
});
});
}

function updateLoadButtons() {
let moreBtn = notificationList.querySelector("#loadMoreBtn");
let lessBtn = notificationList.querySelector("#loadLessBtn");

if (moreBtn) moreBtn.remove();
if (lessBtn) lessBtn.remove();

const totalFetched = allNotifications.length;
const hasMore = lastDoc && displayedCount < totalFetched;

if (hasMore) {
  moreBtn = document.createElement("button");
  moreBtn.id = "loadMoreBtn";
  moreBtn.textContent = "Load More";
  moreBtn.className = "load-more-btn";
  moreBtn.onclick = () => loadNotifications(false, false);
  notificationList.appendChild(moreBtn);
}

if (displayedCount > ITEMS_PER_PAGE) {
  lessBtn = document.createElement("button");
  lessBtn.id = "loadLessBtn";
  lessBtn.textContent = "Load Less";
  lessBtn.className = "load-less-btn";
  lessBtn.onclick = () => {
    displayedCount = ITEMS_PER_PAGE;
    notificationList.innerHTML = allNotifications
      .slice(0, ITEMS_PER_PAGE)
      .map(notif => renderNotification({ id: notif.id, data: () => notif.data }, communities))
      .join("");
    updateLoadButtons();
    attachNotificationListeners();
  };
  notificationList.appendChild(lessBtn);
}
}

try {
await loadNotifications(true);
} catch (error) {
console.error("Initial load failed:", error);
notificationList.innerHTML = "<p>Failed to load notifications. Try refreshing.</p>";
}

refreshBtn.onclick = async () => {
refreshBtn.disabled = true;
refreshBtn.textContent = "Refreshing...";
try {
  await loadNotifications(false, true);
  await updateNotificationBadge(userId, true);
} catch (error) {
  console.error("Refresh failed:", error);
  notificationList.innerHTML = "<p>Refresh failed. Try again.</p>";
}
refreshBtn.disabled = false;
refreshBtn.textContent = "Refresh";
};

communityFilter.onchange = () => loadNotifications(true);
}

// Mark notification as seen and decrement unseenCount
async function markNotificationSeen(notifId) {
const userId = auth.currentUser?.uid;
if (!userId) {
console.error("No authenticated user found.");
return;
}

const notifRef = doc(db, "users", userId, "notifications", notifId);
const userRef = doc(db, "users", userId);

try {
const notifDoc = await getDoc(notifRef);
if (!notifDoc.exists()) {
  console.warn(`Notification ${notifId} not found.`);
  return;
}

const notifData = notifDoc.data();
if (notifData.seen) {
  console.log(`Notification ${notifId} already seen.`);
  return;
}

await runTransaction(db, async (transaction) => {
  const userDoc = await transaction.get(userRef);
  if (!userDoc.exists()) throw new Error("User not found");
  const currentCount = userDoc.data().unseenCount || 0;
  transaction.update(notifRef, { seen: true });
  if (currentCount > 0) {
    transaction.update(userRef, { unseenCount: currentCount - 1, lastUpdated: new Date() });
  }
});

console.log(`Marked notification ${notifId} as seen.`);

const button = document.querySelector(`.mark-seen-btn2[data-id="${notifId}"]`);
if (button) {
  button.disabled = true;
  button.textContent = "Seen";
  button.classList.add("disabled");
}

await updateNotificationBadge(userId);
if (!document.getElementById("notificationsModal").classList.contains("hidden")) {
  await openNotificationsModal(userId);
}
} catch (error) {
console.error(`Error marking notification ${notifId} as seen:`, error);
}
}

// Clear notifications and reset unseenCount
async function clearNotifications() {
const userId = auth.currentUser?.uid;
if (!userId) {
console.error("No authenticated user found.");
return;
}

const communityFilter = document.getElementById("communityFilter");
if (!communityFilter) {
console.error("Community filter not found.");
return;
}

const selectedCommunity = communityFilter.value;
const confirmMessage = selectedCommunity === "all"
? "Clear all notifications?"
: `Clear notifications for ${communityFilter.options[communityFilter.selectedIndex]?.text || "selected community"} only?`;

if (!confirm(confirmMessage)) {
console.log("User canceled clearing notifications.");
return;
}

try {
const notifsCollection = collection(db, "users", userId, "notifications");
let q;
if (selectedCommunity === "all") {
  q = query(notifsCollection);
} else {
  q = query(notifsCollection, where("communityId", "==", selectedCommunity));
}

const snapshot = await getDocs(q);
if (snapshot.empty) {
  console.log("No notifications to clear.");
  await updateNotificationBadge(userId);
  await openNotificationsModal(userId);
  return;
}

const userRef = doc(db, "users", userId);
await runTransaction(db, async (transaction) => {
  const userDoc = await transaction.get(userRef);
  if (!userDoc.exists()) throw new Error("User not found");
  const currentCount = userDoc.data().unseenCount || 0;
  const unseenToDelete = snapshot.docs.filter(doc => !doc.data().seen).length;
  const newCount = Math.max(0, currentCount - unseenToDelete);
  transaction.update(userRef, { unseenCount: newCount, lastUpdated: new Date() });
  snapshot.docs.forEach(doc => transaction.delete(doc.ref));
});

console.log(`Cleared ${snapshot.size} notifications.`);

await updateNotificationBadge(userId);
await openNotificationsModal(userId);
} catch (error) {
console.error("Error clearing notifications:", error);
}
}

// Timed Refresh for getCommData
let commDataCache = null;
let lastFetchTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes - longer TTL for stability
const ITEMS_PER_PAGE = 100; // Paginate arrays in chunks

async function getCommData(forceRefresh = false) {
const now = Date.now();

// Use in-memory cache if fresh and not forced
if (commDataCache && (now - lastFetchTime < CACHE_TTL) && !forceRefresh) {
//console.log(`Using cached community data (last fetched ${Math.round((now - lastFetchTime) / 1000)}s ago)`);
return commDataCache;
}

const commRef = doc(db, "communities", communityId);
try {
const commDoc = await getDoc(commRef);
if (!commDoc.exists()) throw new Error("Community not found");

const rawData = commDoc.data();

// Fetch members from subcollection instead of rawData.members
const membersSnapshot = await getDocs(collection(db, "communities", communityId, "members"));
const membersList = membersSnapshot.docs.map(doc => doc.id); // Array of UIDs from subcollection

// Proxy members to paginate access lazily and mimic array behavior
const paginatedMembers = new Proxy(membersList, {
  get(target, prop) {
    if (typeof prop === "string" && !isNaN(prop)) {
      // Return paginated chunk if numeric index
      const index = parseInt(prop);
      const start = Math.floor(index / ITEMS_PER_PAGE) * ITEMS_PER_PAGE;
      return target.slice(start, start + ITEMS_PER_PAGE)[index % ITEMS_PER_PAGE];
    }
    if (prop === "length") return target.length;
    if (prop === "includes") return (uid) => target.includes(uid); // Preserve includes
    if (prop === Symbol.iterator) return target[Symbol.iterator].bind(target); // Preserve iteration
    if (prop === "slice") return target.slice.bind(target); // For loadMembersBatch
    if (prop === "filter") return target.filter.bind(target); // For banUser
    if (prop === "concat") return target.concat.bind(target); // For unbanUser
    return target[prop];
  }
});

// Keep bannedUsers and admins as arrays from main doc (for now)
const paginatedBannedUsers = new Proxy(rawData.bannedUsers || [], {
  get(target, prop) {
    if (typeof prop === "string" && !isNaN(prop)) {
      const index = parseInt(prop);
      const start = Math.floor(index / ITEMS_PER_PAGE) * ITEMS_PER_PAGE;
      return target.slice(start, start + ITEMS_PER_PAGE)[index % ITEMS_PER_PAGE];
    }
    if (prop === "length") return target.length;
    if (prop === "includes") return (uid) => target.includes(uid);
    if (prop === Symbol.iterator) return target[Symbol.iterator].bind(target);
    return target[prop];
  }
});

const paginatedAdmins = new Proxy(rawData.admins || [], {
  get(target, prop) {
    if (typeof prop === "string" && !isNaN(prop)) {
      const index = parseInt(prop);
      const start = Math.floor(index / ITEMS_PER_PAGE) * ITEMS_PER_PAGE;
      return target.slice(start, start + ITEMS_PER_PAGE)[index % ITEMS_PER_PAGE];
    }
    if (prop === "length") return target.length;
    if (prop === "includes") return (uid) => target.includes(uid);
    if (prop === Symbol.iterator) return target[Symbol.iterator].bind(target);
    return target[prop];
  }
});

// Build cached object with proxied arrays
commDataCache = {
  ...rawData,
  members: paginatedMembers, // Now from subcollection
  bannedUsers: paginatedBannedUsers,
  admins: paginatedAdmins
};

lastFetchTime = now;
console.log(`Fetched fresh community data for ${communityId} with ${membersList.length} members from subcollection`);
return commDataCache;
} catch (error) {
console.error("Error fetching community data:", error);
if (commDataCache) return commDataCache;
return { members: [], bannedUsers: [], admins: [], creatorId: "", name: "Unknown", banReasons: {} };
}
}

function resetCommDataCache() {
commDataCache = null;
lastFetchTime = 0;
console.log("Cleared community data cache");
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

window.getCommData = getCommData;
window.closeModal = closeModal;
window.debounce = debounce;
window.communitySearchPostsById = searchPostsById;
window.renderPosts = renderPosts;
window.searchPostsById = searchPostsById;
window.fetchUserData = fetchUserData;
window.getCachedUser = getCachedUser;
window.setCachedUser = setCachedUser;
window.fetchCurrentUserData = fetchCurrentUserData;
window.leaveCommunity = leaveCommunity;
window.debouncedLoadAdminReportSummary = debouncedLoadAdminReportSummary;
window.delay = delay;
window.resetCommDataCache = resetCommDataCache;