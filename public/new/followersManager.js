import { auth, doc, getDoc, collection, query, limit, getDocs, deleteDoc, where, orderBy, startAfter, db } from './firebaseConfig.js';

let followersArray = [];
let followingArray = [];
let lastFollowersCursor = null;
let lastFollowingCursor = null;
let lastSearchFollowersCursor = null;
let lastSearchFollowingCursor = null;
let searchTerm = "";
const FOLLOWERS_PAGE_SIZE = 10;

async function viewFollowers(userId) {
  const modal = document.getElementById("viewFollowersModal");
  const followersContent = document.getElementById("followersList");
  const followersSearchInput = document.getElementById("followerSearch");
  const followersTabBtn = document.getElementById("followersTab");
  const followingTabBtn = document.getElementById("followingTab");

  if (!modal || !followersContent || !followersSearchInput || !followersTabBtn || !followingTabBtn) {
    console.error("Followers modal elements missing!");
    return;
  }
  
lastFollowersCursor = null;
lastFollowingCursor = null;
lastSearchFollowersCursor = null;
lastSearchFollowingCursor = null;

followersContent.innerHTML = '<div class="loading">Loading...</div>';
modal.style.display = "flex";
modal.classList.remove("hidden");

const userRef = doc(db, "users", userId);
let userDoc;
try {
  userDoc = await getDoc(userRef);
} catch (error) {
  console.error("Error fetching user doc:", error);
  followersContent.innerHTML = "<p>Failed to load data. Try again.</p>";
  return;
}
const totalFollowersCount = userDoc.exists() ? (userDoc.data().followerCount || 0) : 0;
const totalFollowingCount = userDoc.exists() ? (userDoc.data().followingCount || 0) : 0;
console.log("Total followers from followerCount:", totalFollowersCount);
console.log("Total following from followingCount:", totalFollowingCount);

followersTabBtn.textContent = `Followers: ${totalFollowersCount}`;
followingTabBtn.textContent = `Following: ${totalFollowingCount}`;

await loadFollowersTab(userId, totalFollowersCount);

followersTabBtn.onclick = () => {
  followersTabBtn.classList.add("active");
  followingTabBtn.classList.remove("active");
  followersSearchInput.value = "";
  searchTerm = "";
  loadFollowersTab(userId, totalFollowersCount);
};
followingTabBtn.onclick = () => {
  followingTabBtn.classList.add("active");
  followersTabBtn.classList.remove("active");
  followersSearchInput.value = "";
  searchTerm = "";
  loadFollowingTab(userId, totalFollowingCount);
};

followersSearchInput.oninput = debounce((e) => {
  searchTerm = e.target.value;
  if (followersTabBtn.classList.contains("active")) {
    searchFollowers(userId, searchTerm, totalFollowersCount);
  } else {
    searchFollowing(userId, searchTerm, totalFollowingCount);
  }
}, 300);
document.getElementById("closeFollowersBtn").addEventListener("click", () => closeModal("viewFollowersModal"));
}

// Load Followers Tab
async function loadFollowersTab(userId, totalFollowersCount) {
const followersContent = document.getElementById("followersList");
const followersRef = collection(db, "users", userId, "followers");
const q = query(followersRef, limit(FOLLOWERS_PAGE_SIZE));
let snapshot;
try {
  snapshot = await getDocs(q);
} catch (error) {
  console.error("Error fetching followers:", error);
  followersContent.innerHTML = "<p>Failed to load followers. Try again.</p>";
  return;
}
followersArray = snapshot.docs.map(doc => ({
  uid: doc.data().followerId,
  username: doc.data().username || "Unknown"
}));
console.log("Initial followers loaded:", followersArray.length);
await loadFollowersBatch(userId, snapshot, true, totalFollowersCount);
}

// Load Following Tab
async function loadFollowingTab(userId, totalFollowingCount) {
const followersContent = document.getElementById("followersList");
const followingRef = collection(db, "users", userId, "following");
const q = query(followingRef, limit(FOLLOWERS_PAGE_SIZE));
let snapshot;
try {
  snapshot = await getDocs(q);
} catch (error) {
  console.error("Error fetching following:", error);
  followersContent.innerHTML = "<p>Failed to load following. Try again.</p>";
  return;
}
followingArray = snapshot.docs.map(doc => ({
  uid: doc.data().followingId,
  username: doc.data().username || "Unknown"
}));
console.log("Initial following loaded:", followingArray.length);
await loadFollowingBatch(userId, snapshot, true, totalFollowingCount);
}

// Load Followers Batch
async function loadFollowersBatch(userId, snapshot, reset = false, totalFollowersCount) {
  const followersContent = document.getElementById("followersList");
  const currentUser = auth.currentUser;

  if (reset) {
    followersContent.innerHTML = "";
    lastFollowersCursor = null;
  }

  if (snapshot.empty && followersContent.querySelectorAll(".user-item2").length === 0) {
    followersContent.innerHTML = "<p>No followers yet!</p>";
    updateFollowersPaginationButtons(userId, totalFollowersCount, 0);
    return;
  }

  snapshot.docs.forEach(doc => {
    const followerData = doc.data();
    const followerId = followerData.followerId;
    const username = followerData.username || "Unknown";
    const itemId = `follower-${followerId}`;
    if (!document.getElementById(itemId)) {
      const isSelf = userId === currentUser.uid;
      const followerDiv = document.createElement("div");
      followerDiv.className = "user-item";
      followerDiv.id = itemId;
      followerDiv.innerHTML = `
        <span class="username" data-uid="${followerId}">${username}</span>
        <div class="action-buttons"></div>
      `;
      followersContent.appendChild(followerDiv);
      followerDiv.style.opacity = 0;
      setTimeout(() => {
        followerDiv.style.transition = "opacity 0.3s ease";
        followerDiv.style.opacity = 1;
      }, 10);
      followerDiv.querySelector(`.username[data-uid="${followerId}"]`).addEventListener("click", () => viewProfile(followerId));
    }
  });

  // New: Cap at 50 items
  const allItems = followersContent.querySelectorAll(".user-item2");
  if (allItems.length > 50) {
    for (let i = 0; i < allItems.length - 50; i++) {
      followersContent.removeChild(allItems[i]); // Remove oldest
    }
  }

  lastFollowersCursor = snapshot.docs.length === FOLLOWERS_PAGE_SIZE ? snapshot.docs[snapshot.docs.length - 1] : null;
  const loadedFollowerCount = followersContent.querySelectorAll(".user-item2").length;
  updateFollowersPaginationButtons(userId, totalFollowersCount, loadedFollowerCount);
}

// Load Following Batch
async function loadFollowingBatch(userId, snapshot, reset = false, totalFollowingCount) {
  const followersContent = document.getElementById("followersList");
  const currentUser = auth.currentUser;

  if (reset) {
    followersContent.innerHTML = "";
    lastFollowingCursor = null;
  }

  if (snapshot.empty && followersContent.querySelectorAll(".user-item2").length === 0) {
    followersContent.innerHTML = "<p>You aren't following anyone yet!</p>";
    updateFollowingPaginationButtons(userId, totalFollowingCount, 0);
    return;
  }

  snapshot.docs.forEach(doc => {
    const followingData = doc.data();
    const followingId = followingData.followingId;
    const username = followingData.username || "Unknown";
    const itemId = `following-${followingId}`;
    if (!document.getElementById(itemId)) {
      const isSelf = userId === currentUser.uid;
      const followingDiv = document.createElement("div");
      followingDiv.className = "user-item";
      followingDiv.id = itemId;
      followingDiv.innerHTML = `
        <span class="username" data-uid="${followingId}">${username}</span>
        <div class="action-buttons">
          <button class="action-btn activities-btn" data-uid="${followingId}">User Communities</button>
        </div>
      `;
      followersContent.appendChild(followingDiv);
      followingDiv.style.opacity = 0;
      setTimeout(() => {
        followingDiv.style.transition = "opacity 0.3s ease";
        followingDiv.style.opacity = 1;
      }, 10);

      followingDiv.querySelector(`.username[data-uid="${followingId}"]`).addEventListener("click", () => viewProfile(followingId));
      const activitiesBtn = followingDiv.querySelector(".activities-btn");
      if (activitiesBtn) {
        activitiesBtn.addEventListener("click", () => viewUserActivities(followingId));
      }
    }
  });

  // Cap at 50 items
  const allItems = followersContent.querySelectorAll(".user-item2");
  if (allItems.length > 50) {
    for (let i = 0; i < allItems.length - 50; i++) {
      followersContent.removeChild(allItems[i]); // Remove oldest
    }
  }

  lastFollowingCursor = snapshot.docs.length === FOLLOWERS_PAGE_SIZE ? snapshot.docs[snapshot.docs.length - 1] : null;
  const loadedFollowingCount = followersContent.querySelectorAll(".user-item2").length;
  updateFollowingPaginationButtons(userId, totalFollowingCount, loadedFollowingCount);
}

// Search Followers
async function searchFollowers(userId, searchTerm, totalFollowersCount) {
const followersContent = document.getElementById("followersList");

followersContent.innerHTML = '<div class="loading">Searching...</div>';

if (!searchTerm) {
  lastFollowersCursor = null;
  lastSearchFollowersCursor = null;
  return loadFollowersTab(userId, totalFollowersCount);
}

const followersRef = collection(db, "users", userId, "followers");
const q = query(
  followersRef,
  orderBy("username"), // Required for startAfter
  where("username", ">=", searchTerm.toLowerCase()),
  where("username", "<=", searchTerm.toLowerCase() + '\uf8ff'),
  limit(FOLLOWERS_PAGE_SIZE)
);
let snapshot;
try {
  snapshot = await getDocs(q);
} catch (error) {
  console.error("Error searching followers:", error);
  followersContent.innerHTML = "<p>Failed to search followers.</p>";
  return;
}

followersArray = snapshot.docs.map(doc => ({
  uid: doc.data().followerId,
  username: doc.data().username || "Unknown"
}));
console.log(`Search filtered followers: ${followersArray.length} matches for "${searchTerm}"`);

await loadSearchFollowersBatch(userId, snapshot, true, totalFollowersCount);
}

// Search Following
async function searchFollowing(userId, searchTerm, totalFollowingCount) {
const followersContent = document.getElementById("followersList");

followersContent.innerHTML = '<div class="loading">Searching...</div>';

if (!searchTerm) {
  lastFollowingCursor = null;
  lastSearchFollowingCursor = null;
  return loadFollowingTab(userId, totalFollowingCount);
}

const followingRef = collection(db, "users", userId, "following");
const q = query(
  followingRef,
  orderBy("username"), // Required for startAfter
  where("username", ">=", searchTerm.toLowerCase()),
  where("username", "<=", searchTerm.toLowerCase() + '\uf8ff'),
  limit(FOLLOWERS_PAGE_SIZE)
);
let snapshot;
try {
  snapshot = await getDocs(q);
} catch (error) {
  console.error("Error searching following:", error);
  followersContent.innerHTML = "<p>Failed to search following.</p>";
  return;
}

followingArray = snapshot.docs.map(doc => ({
  uid: doc.data().followingId,
  username: doc.data().username || "Unknown"
}));
console.log(`Search filtered following: ${followingArray.length} matches for "${searchTerm}"`);

await loadSearchFollowingBatch(userId, snapshot, true, totalFollowingCount);
}

// Pagination Buttons
function updateFollowersPaginationButtons(userId, totalCount, loadedCount) {
const followersContent = document.getElementById("followersList");
const existingMoreBtn = followersContent.querySelector("#seeMoreFollowersBtn");
const existingLessBtn = followersContent.querySelector("#seeLessFollowersBtn");
if (existingMoreBtn) existingMoreBtn.remove();
if (existingLessBtn) existingLessBtn.remove();

if (totalCount > 0 && loadedCount > 0) {
  const seeMore = document.createElement("button");
  seeMore.id = "seeMoreFollowersBtn";
  seeMore.textContent = "See More";
  seeMore.className = "see-more-btn";
  seeMore.style.display = totalCount > loadedCount ? "block" : "none";
  seeMore.onclick = async () => {
    const followersRef = collection(db, "users", userId, "followers");
    const q = query(followersRef, startAfter(lastFollowersCursor), limit(FOLLOWERS_PAGE_SIZE));
    const nextSnapshot = await getDocs(q);
    followersArray = followersArray.concat(nextSnapshot.docs.map(doc => ({
      uid: doc.data().followerId,
      username: doc.data().username || "Unknown"
    })));
    await loadFollowersBatch(userId, nextSnapshot, false, totalCount);
  };

  const seeLess = document.createElement("button");
  seeLess.id = "seeLessFollowersBtn";
  seeLess.textContent = "See Less";
  seeLess.className = "see-less-btn";
  seeLess.style.display = loadedCount > FOLLOWERS_PAGE_SIZE ? "block" : "none";
  seeLess.onclick = () => loadFollowersTab(userId, totalCount);

  followersContent.appendChild(seeMore);
  followersContent.appendChild(seeLess);
}
}

function updateFollowingPaginationButtons(userId, totalCount, loadedCount) {
const followersContent = document.getElementById("followersList");
const existingMoreBtn = followersContent.querySelector("#seeMoreFollowingBtn");
const existingLessBtn = followersContent.querySelector("#seeLessFollowingBtn");
if (existingMoreBtn) existingMoreBtn.remove();
if (existingLessBtn) existingLessBtn.remove();

if (totalCount > 0 && loadedCount > 0) {
  const seeMore = document.createElement("button");
  seeMore.id = "seeMoreFollowingBtn";
  seeMore.textContent = "See More";
  seeMore.className = "see-more-btn";
  seeMore.style.display = totalCount > loadedCount ? "block" : "none";
  seeMore.onclick = async () => {
    const followingRef = collection(db, "users", userId, "following");
    const q = query(followingRef, startAfter(lastFollowingCursor), limit(FOLLOWERS_PAGE_SIZE));
    const nextSnapshot = await getDocs(q);
    followingArray = followingArray.concat(nextSnapshot.docs.map(doc => ({
      uid: doc.data().followingId,
      username: doc.data().username || "Unknown"
    })));
    await loadFollowingBatch(userId, nextSnapshot, false, totalCount);
  };

  const seeLess = document.createElement("button");
  seeLess.id = "seeLessFollowingBtn";
  seeLess.textContent = "See Less";
  seeLess.className = "see-less-btn";
  seeLess.style.display = loadedCount > FOLLOWERS_PAGE_SIZE ? "block" : "none";
  seeLess.onclick = () => loadFollowingTab(userId, totalCount);

  followersContent.appendChild(seeMore);
  followersContent.appendChild(seeLess);
}
}

// Search Pagination Buttons
function updateSearchFollowerButtons(userId, totalCount, loadedCount, type) {
const followersContent = document.getElementById("followersList");
const prefix = type === "followers" ? "Followers" : "Following";
const existingMoreBtn = followersContent.querySelector(`#seeMore${prefix}Btn`);
const existingLessBtn = followersContent.querySelector(`#seeLess${prefix}Btn`);
if (existingMoreBtn) existingMoreBtn.remove();
if (existingLessBtn) existingLessBtn.remove();

if (loadedCount > 0) { // Only show buttons if there’s something loaded
  const seeMore = document.createElement("button");
  seeMore.id = `seeMore${prefix}Btn`;
  seeMore.textContent = "See More";
  seeMore.className = "see-more-btn";
  const hasMore = lastSearchFollowersCursor || lastSearchFollowingCursor; // Check if there’s a cursor for more
  seeMore.style.display = hasMore ? "block" : "none"; // Only show if more to fetch
  seeMore.onclick = async () => {
    const ref = type === "followers" ? collection(db, "users", userId, "followers") : collection(db, "users", userId, "following");
    const cursor = type === "followers" ? lastSearchFollowersCursor : lastSearchFollowingCursor;
    const q = query(
      ref,
      orderBy("username"), // Match orderBy with initial query
      where("username", ">=", searchTerm.toLowerCase()),
      where("username", "<=", searchTerm.toLowerCase() + '\uf8ff'),
      startAfter(cursor),
      limit(FOLLOWERS_PAGE_SIZE)
    );
    const nextSnapshot = await getDocs(q);
    const nextBatch = nextSnapshot.docs.map(doc => ({
      uid: doc.data()[type === "followers" ? "followerId" : "followingId"],
      username: doc.data().username || "Unknown"
    }));
    if (type === "followers") {
      followersArray = followersArray.concat(nextBatch);
      await loadSearchFollowersBatch(userId, nextSnapshot, false, totalCount);
    } else {
      followingArray = followingArray.concat(nextBatch);
      await loadSearchFollowingBatch(userId, nextSnapshot, false, totalCount);
    }
  };

  const seeLess = document.createElement("button");
  seeLess.id = `seeLess${prefix}Btn`;
  seeLess.textContent = "See Less";
  seeLess.className = "see-less-btn";
  seeLess.style.display = loadedCount > FOLLOWERS_PAGE_SIZE ? "block" : "none";
  seeLess.onclick = () => type === "followers" ? loadFollowersTab(userId, totalFollowersCount) : loadFollowingTab(userId, totalFollowingCount);

  followersContent.appendChild(seeMore);
  followersContent.appendChild(seeLess);
}
}

// Helper: Load Search Followers Batch
async function loadSearchFollowersBatch(userId, snapshot, reset = false, totalFollowersCount) {
  const followersContent = document.getElementById("followersList");
  const currentUser = auth.currentUser;

  if (reset) {
    followersContent.innerHTML = "";
  }

  if (snapshot.empty && followersContent.querySelectorAll(".user-item2").length === 0) {
    followersContent.innerHTML = "<p>No matching followers found.</p>";
    updateSearchFollowerButtons(userId, totalFollowersCount, 0, "followers");
    return;
  }

  followersContent.innerHTML = reset ? "" : followersContent.innerHTML;
  snapshot.docs.forEach(doc => {
    const followerData = doc.data();
    const followerId = followerData.followerId;
    const username = followerData.username || "Unknown";
    const itemId = `follower-${followerId}`;
    if (!document.getElementById(itemId)) {
      const isSelf = userId === currentUser.uid;
      const followerDiv = document.createElement("div");
      followerDiv.className = "user-item";
      followerDiv.id = itemId;
      followerDiv.innerHTML = `
        <span class="username" data-uid="${followerId}">${username}</span>
        <div class="action-buttons">
        </div>
      `;
      followersContent.appendChild(followerDiv);
      followerDiv.style.opacity = 0;
      setTimeout(() => {
        followerDiv.style.transition = "opacity 0.3s ease";
        followerDiv.style.opacity = 1;
      }, 10);

      followerDiv.querySelector(`.username[data-uid="${followerId}"]`).addEventListener("click", () => viewProfile(followerId));
    }
  });

  // Cap at 50 items
  const allItems = followersContent.querySelectorAll(".user-item2");
  if (allItems.length > 50) {
    for (let i = 0; i < allItems.length - 50; i++) {
      followersContent.removeChild(allItems[i]); // Remove oldest
    }
  }

  lastSearchFollowersCursor = snapshot.docs.length === FOLLOWERS_PAGE_SIZE ? snapshot.docs[snapshot.docs.length - 1] : null;
  const loadedFollowerCount = followersContent.querySelectorAll(".user-item2").length;
  updateSearchFollowerButtons(userId, totalFollowersCount, loadedFollowerCount, "followers");
}

// Helper: Load Search Following Batch
async function loadSearchFollowingBatch(userId, snapshot, reset = false, totalFollowingCount) {
  const followersContent = document.getElementById("followersList");
  const currentUser = auth.currentUser;

  if (reset) {
    followersContent.innerHTML = "";
  }

  if (snapshot.empty && followersContent.querySelectorAll(".user-item2").length === 0) {
    followersContent.innerHTML = "<p>No matching following found.</p>";
    updateSearchFollowerButtons(userId, totalFollowingCount, 0, "following");
    return;
  }

  followersContent.innerHTML = reset ? "" : followersContent.innerHTML;
  snapshot.docs.forEach(doc => {
    const followingData = doc.data();
    const followingId = followingData.followingId;
    const username = followingData.username || "Unknown";
    const itemId = `following-${followingId}`;
    if (!document.getElementById(itemId)) {
      const isSelf = userId === currentUser.uid;
      const followingDiv = document.createElement("div");
      followingDiv.className = "user-item";
      followingDiv.id = itemId;
      followingDiv.innerHTML = `
        <span class="username" data-uid="${followingId}">${username}</span>
        <div class="action-buttons">
          <button class="action-btn activities-btn" data-uid="${followingId}">User Communities</button>
        </div>
      `;
      followersContent.appendChild(followingDiv);
      followingDiv.style.opacity = 0;
      setTimeout(() => {
        followingDiv.style.transition = "opacity 0.3s ease";
        followingDiv.style.opacity = 1;
      }, 10);

      followingDiv.querySelector(`.username[data-uid="${followingId}"]`).addEventListener("click", () => viewProfile(followingId));
      const activitiesBtn = followingDiv.querySelector(".activities-btn");
      if (activitiesBtn) {
        activitiesBtn.addEventListener("click", () => viewUserActivities(followingId));
      }
    }
  });

  // Cap at 50 items
  const allItems = followersContent.querySelectorAll(".user-item2");
  if (allItems.length > 50) {
    for (let i = 0; i < allItems.length - 50; i++) {
      followersContent.removeChild(allItems[i]); // Remove oldest
    }
  }

  lastSearchFollowingCursor = snapshot.docs.length === FOLLOWERS_PAGE_SIZE ? snapshot.docs[snapshot.docs.length - 1] : null;
  const loadedFollowingCount = followersContent.querySelectorAll(".user-item2").length;
  updateSearchFollowerButtons(userId, totalFollowingCount, loadedFollowingCount, "following");
}

async function viewUserActivities(userId) {
  const modal = document.getElementById("userActivitiesModal");
  const activitiesList = document.getElementById("activitiesList");

  if (!modal || !activitiesList) {
    console.error("User activities modal elements missing!");
    return;
  }

  activitiesList.innerHTML = '<div class="loading">Loading...</div>';
  modal.style.display = "flex";
  modal.classList.remove("hidden");

  const userRef = doc(db, "users", userId);
  let userDoc;
  try {
    userDoc = await getDoc(userRef);
    if (!userDoc.exists()) {
      throw new Error("User document not found");
    }
  } catch (error) {
    console.error("Error fetching user data:", error);
    activitiesList.innerHTML = "<p>Failed to load user data.</p>";
    return;
  }

  const username = userDoc.data().username || "Unknown User";
  console.log(`Fetched username for user ${userId}: ${username}`);

  const header = modal.querySelector("h2") || document.createElement("h2");
  if (!modal.querySelector("h2")) modal.querySelector(".modal-content").prepend(header);
  header.innerHTML = `${username} communities`;

  if (!userDoc.data().communityIds || userDoc.data().communityIds.length === 0) {
    activitiesList.innerHTML = "<p>User is not in any communities.</p>";
  } else {
    const communityIds = userDoc.data().communityIds;
    console.log(`User ${userId} communityIds:`, communityIds);

    const communities = [];
    for (const commId of communityIds) {
      const commRef = doc(db, "communities", commId);
      const memberRef = doc(db, "communities", commId, "members", userId);
      
      const [commDoc, memberDoc] = await Promise.all([getDoc(commRef), getDoc(memberRef)]);
      
      if (commDoc.exists() && memberDoc.exists()) {
        // User is still a member if their doc exists in the subcollection
        communities.push({ id: commId, name: commDoc.data().name || "Unnamed Community" });
        console.log(`User ${userId} confirmed in community ${commId}`);
      } else {
        console.log(`User ${userId} not in community ${commId} (comm exists: ${commDoc.exists()}, member exists: ${memberDoc.exists()})`);
      }
    }

    activitiesList.innerHTML = communities.length > 0
      ? communities.map(comm => `
          <div class="community-item">
            <span>${comm.name}</span>
            <button class="copy-id-btn" data-id="${comm.id}">Copy ID</button>
          </div>
        `).join("")
      : "<p>No valid communities found.</p>";

    activitiesList.querySelectorAll(".copy-id-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(btn.dataset.id)
          .then(() => console.log(`Copied community ID: ${btn.dataset.id}`))
          .catch(err => console.error("Failed to copy ID:", err));
      });
    });
  }

  document.getElementById("closeActivitiesBtn").addEventListener("click", () => closeModal("userActivitiesModal"));
}

window.viewFollowers = viewFollowers;