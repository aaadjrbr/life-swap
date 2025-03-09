import { auth, doc, setDoc, getDoc, updateDoc, addDoc, runTransaction, deleteField, collection, query, limit, getDocs, deleteDoc, where, orderBy, startAfter, db, writeBatch } from './firebaseConfig.js';
import { communityId, userDataCache } from './main.js';
export { liftBan, removeBanHistory }; // Export new function

let lastBannedDoc = null;

async function viewBannedUsers(communityId) {
  const modal = document.getElementById("viewBannedModal");
  const bannedList = document.getElementById("bannedList");
  const bannedSearch = document.getElementById("bannedSearch");

  lastBannedDoc = null;
  bannedList.innerHTML = '<div class="loading">⏳ Loading...</div>';
  modal.style.display = "flex";
  modal.classList.remove("hidden");

  const commRef = doc(db, "communities", communityId);
  const commDoc = await getDoc(commRef);
  const commData = commDoc.data();
  const bannedUsers = commData.bannedUsers || [];
  console.log("Total banned users:", bannedUsers.length);

  // Appeals section
  const messagesDiv = modal.querySelector("#bannedMessages") || document.createElement("div");
  if (!modal.querySelector("#bannedMessages")) {
    messagesDiv.id = "bannedMessages";
    messagesDiv.className = "banned-messages";
    bannedList.before(messagesDiv);
  }
  const appealsRef = collection(db, "communities", communityId, "banAppeals");
  const appealsSnapshot = await getDocs(appealsRef);
  if (!appealsSnapshot.empty) {
    messagesDiv.innerHTML = "<h3>Appeal Messages (Bans/Posts)</h3>";
    for (const doc of appealsSnapshot.docs) {
      const appeal = doc.data();
      const userData = await fetchUserData(appeal.userId);
      const displayName = `${userData.name || "Unknown"} (${appeal.username || "unknown"})`;
      messagesDiv.innerHTML += `
        <div class="appeal-item" data-appeal-id="${doc.id}">
          <p><strong>${displayName}:</strong> ${appeal.message}</p>
          <span>${new Date(appeal.timestamp.toDate()).toLocaleString()}</span>
          <button class="delete-appeal-btn" data-appeal-id="${doc.id}">Delete</button>
        </div>
      `;
    }
    messagesDiv.querySelectorAll(".delete-appeal-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("Delete this appeal?")) {
          await deleteDoc(doc(db, "communities", communityId, "banAppeals", btn.dataset.appealId));
          messagesDiv.querySelector(`.appeal-item[data-appeal-id="${btn.dataset.appealId}"]`).remove();
          if (!messagesDiv.querySelector(".appeal-item")) messagesDiv.innerHTML = "<p>No appeals yet.</p>";
        }
      });
    });
  } else {
    messagesDiv.innerHTML = "<p>No appeals yet.</p>";
  }

  await loadBannedBatch(commData, true); // Pass full commData to access banStatus

  bannedSearch.oninput = debounce((e) => searchBanned(commData, e.target.value), 300);
  modal.querySelector("#closeBannedBtn").addEventListener("click", () => closeModal("viewBannedModal"));
}

async function loadBannedBatch(commData, reset = false) {
  const bannedList = document.getElementById("bannedList");
  const ITEMS_PER_PAGE = 10;
  const bannedUsers = commData.bannedUsers || [];
  const banStatus = commData.banStatus || {};

  if (reset) {
    bannedList.innerHTML = "";
    lastBannedDoc = null;
  }

  const startIndex = lastBannedDoc ? bannedList.querySelectorAll(".ban-items").length : 0;
  const batch = bannedUsers.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  console.log("Loading banned batch:", { startIndex, batchSize: batch.length });

  if (batch.length === 0) {
    if (startIndex === 0) {
      bannedList.innerHTML = "<p>No banned users.</p>";
    }
    updateBannedButtons(bannedUsers.length, startIndex);
    return;
  }

  const q = query(collection(db, "users"), where("__name__", "in", batch));
  const snapshot = await getDocs(q);
  console.log("Fetched banned users:", snapshot.docs.length);

  snapshot.docs.forEach(doc => {
    const userData = doc.data();
    const uid = doc.id;
    const itemId = `banned-${uid}`;
    if (!document.getElementById(itemId)) {
      const status = banStatus[uid] || "active"; // Default to "active" if missing
      const bannedDiv = document.createElement("div");
      bannedDiv.className = "ban-items";
      bannedDiv.id = itemId;
      bannedDiv.innerHTML = `
        <img loading="lazy" src="${userData.profilePhoto || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'}" alt="Profile">
        <span class="username" data-uid="${uid}">${userData.name}</span>
        <span class="ban-status">${status === "active" ? "Banned" : "Ban Lifted"}</span>
        <div class="ban-actions2">
        <button class="remove-ban-btn" data-uid="${uid}" ${status === "lifted" ? "disabled" : ""}>Lift Ban</button>
        <button class="reinstate-ban-btn" data-uid="${uid}" ${status === "active" ? "disabled" : ""}>Reinstate Ban</button>
        <button class="remove-history-btn" data-uid="${uid}">Remove History</button>
        </div>
      `;
      bannedList.appendChild(bannedDiv);
      bannedDiv.querySelector(`.username[data-uid="${uid}"]`).addEventListener("click", () => viewProfile(uid));
      bannedDiv.querySelector(`.remove-ban-btn`).addEventListener("click", () => liftBan(communityId, uid));
      bannedDiv.querySelector(`.reinstate-ban-btn`).addEventListener("click", () => reinstateBan(communityId, uid));
      bannedDiv.querySelector(`.remove-history-btn`).addEventListener("click", () => removeBanHistory(communityId, uid));
    }
  });

  lastBannedDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
  const loadedCount = bannedList.querySelectorAll(".ban-items").length;
  console.log("Loaded banned count:", loadedCount);

  updateBannedButtons(bannedUsers.length, loadedCount);
}

function updateBannedButtons(totalBanned, loadedCount) {
  const bannedList = document.getElementById("bannedList");
  const ITEMS_PER_PAGE = 10;

  const existingMoreBtn = bannedList.querySelector("#seeMoreBannedBtn");
  const existingLessBtn = bannedList.querySelector("#seeLessBannedBtn");
  if (existingMoreBtn) existingMoreBtn.remove();
  if (existingLessBtn) existingLessBtn.remove();

  console.log("Updating banned buttons:", { totalBanned, loadedCount });

  if (totalBanned > 0) {
    const seeMore = document.createElement("button");
    seeMore.id = "seeMoreBannedBtn";
    seeMore.textContent = "See More";
    seeMore.className = "see-more-btn";
    seeMore.style.display = (totalBanned > ITEMS_PER_PAGE && loadedCount < totalBanned) ? "block" : "none";
    seeMore.onclick = () => loadBannedBatch(commData);

    const seeLess = document.createElement("button");
    seeLess.id = "seeLessBannedBtn";
    seeLess.textContent = "See Less";
    seeLess.className = "see-less-btn";
    seeLess.style.display = (loadedCount > ITEMS_PER_PAGE) ? "block" : "none";
    seeLess.onclick = () => loadBannedBatch(commData, true);

    bannedList.appendChild(seeMore);
    bannedList.appendChild(seeLess);
  }
}

async function searchBanned(commData, searchTerm) {
  const bannedList = document.getElementById("bannedList");
  const ITEMS_PER_PAGE = 10;
  const bannedUsers = commData.bannedUsers || [];
  const banStatus = commData.banStatus || {};
  let startIndex = 0;

  bannedList.innerHTML = '<div class="loading">⏳ Searching...</div>';

  if (!searchTerm) {
    lastBannedDoc = null;
    return loadBannedBatch(commData, true);
  }

  const filteredBanned = bannedUsers.filter(uid => {
    const user = userDataCache[uid];
    return user && (
      user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.username.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });
  console.log(`Search filtered banned: ${filteredBanned.length} matches for "${searchTerm}"`);

  async function loadSearchBatch(reset = false) {
    if (reset) {
      startIndex = 0;
      bannedList.innerHTML = "";
    }

    const batch = filteredBanned.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    if (batch.length === 0) {
      if (startIndex === 0) {
        bannedList.innerHTML = "<p>No matching banned users found.</p>";
      }
      updateSearchButtons(filteredBanned.length, startIndex);
      return;
    }

    const q = query(collection(db, "users"), where("__name__", "in", batch));
    const snapshot = await getDocs(q);

    if (startIndex === 0) bannedList.innerHTML = "";
    snapshot.docs.forEach(doc => {
      const userData = doc.data();
      const uid = doc.id;
      const itemId = `banned-${uid}`;
      if (!document.getElementById(itemId)) {
        const status = banStatus[uid] || "active";
        const bannedDiv = document.createElement("div");
        bannedDiv.className = "ban-items";
        bannedDiv.id = itemId;
        bannedDiv.innerHTML = `
          <img loading="lazy" src="${userData.profilePhoto || 'https://firebasestorage.googleapis.com/v0/b/life-swap-6065e.firebasestorage.app/o/static%2Fprofile-pic-green.webp?alt=media&token=cdba35d8-86b1-496a-850a-88920da9cda4'}" alt="Profile">
          <span class="username" data-uid="${uid}">${userData.name}</span>
          <span class="ban-status">${status === "active" ? "Banned" : "Ban Lifted"}</span>
          <button class="remove-ban-btn" data-uid="${uid}" ${status === "lifted" ? "disabled" : ""}>Lift Ban</button>
          <button class="reinstate-ban-btn" data-uid="${uid}" ${status === "active" ? "disabled" : ""}>Reinstate Ban</button>
          <button class="remove-history-btn" data-uid="${uid}">Remove History</button>
        `;
        bannedList.appendChild(bannedDiv);
        bannedDiv.querySelector(`.username[data-uid="${uid}"]`).addEventListener("click", () => viewProfile(uid));
        bannedDiv.querySelector(`.remove-ban-btn`).addEventListener("click", () => liftBan(communityId, uid));
        bannedDiv.querySelector(`.reinstate-ban-btn`).addEventListener("click", () => reinstateBan(communityId, uid));
        bannedDiv.querySelector(`.remove-history-btn`).addEventListener("click", () => removeBanHistory(communityId, uid));
      }
    });

    const loadedCount = bannedList.querySelectorAll(".ban-items").length;
    updateSearchButtons(filteredBanned.length, loadedCount);
  }

  function updateSearchButtons(totalFiltered, loadedCount) {
    const existingMoreBtn = bannedList.querySelector("#seeMoreSearchBannedBtn");
    const existingLessBtn = bannedList.querySelector("#seeLessSearchBannedBtn");
    if (existingMoreBtn) existingMoreBtn.remove();
    if (existingLessBtn) existingLessBtn.remove();

    if (totalFiltered > 0) {
      const seeMore = document.createElement("button");
      seeMore.id = "seeMoreSearchBannedBtn";
      seeMore.textContent = "See More";
      seeMore.className = "see-more-btn";
      seeMore.style.display = (totalFiltered > loadedCount) ? "block" : "none";
      seeMore.onclick = () => {
        startIndex += ITEMS_PER_PAGE;
        loadSearchBatch();
      };

      const seeLess = document.createElement("button");
      seeLess.id = "seeLessSearchBannedBtn";
      seeLess.textContent = "See Less";
      seeLess.className = "see-less-btn";
      seeLess.style.display = (loadedCount > ITEMS_PER_PAGE) ? "block" : "none";
      seeLess.onclick = () => loadSearchBatch(true);

      bannedList.appendChild(seeMore);
      bannedList.appendChild(seeLess);
    }
  }

  await loadSearchBatch(true);
}

async function liftBan(communityId, uid) {
  const commRef = doc(db, "communities", communityId);
  const commDoc = await getDoc(commRef);
  const commData = commDoc.data();
  const bannedUsers = commData.bannedUsers || [];

  if (bannedUsers.includes(uid)) {
    if (confirm("Lift the ban for this user? They’ll be able to join the community again.")) {
      await updateDoc(commRef, {
        [`banStatus.${uid}`]: "lifted"
      });
      alert("Ban lifted! User can now join the community.");
      viewBannedUsers(communityId); // Refresh UI
    }
  } else {
    alert("User not found in banned list!");
  }
}

async function reinstateBan(communityId, uid) {
  const commRef = doc(db, "communities", communityId);
  const commDoc = await getDoc(commRef);
  const commData = commDoc.data();
  const bannedUsers = commData.bannedUsers || [];

  if (bannedUsers.includes(uid)) {
    if (confirm("Reinstate the ban? This user will be blocked from the community again.")) {
      await updateDoc(commRef, {
        [`banStatus.${uid}`]: "active"
      });
      alert("Ban reinstated! User is blocked again.");
      viewBannedUsers(communityId); // Refresh UI
    }
  } else {
    alert("User not found in banned list!");
  }
}

async function removeBanHistory(communityId, uid) {
  const commRef = doc(db, "communities", communityId);
  const commDoc = await getDoc(commRef);
  const commData = commDoc.data();
  const bannedUsers = commData.bannedUsers || [];

  if (!bannedUsers.includes(uid)) {
    alert("User not found in banned list!");
    return;
  }

  if (confirm("Remove ban history for this user? This will erase all ban records as if they were never banned.")) {
    try {
      const batch = writeBatch(db);

      // Remove from bannedUsers array
      const updatedBannedUsers = bannedUsers.filter(id => id !== uid);

      // Prepare updates: remove from bannedUsers, banStatus, and banReasons
      const updates = {
        bannedUsers: updatedBannedUsers,
        [`banStatus.${uid}`]: deleteField(), // Remove from banStatus
        [`banReasons.${uid}`]: deleteField() // Remove from banReasons
      };

      batch.update(commRef, updates);
      await batch.commit();

      alert("Ban history removed! It’s like they were never banned.");
      viewBannedUsers(communityId); // Refresh UI
    } catch (error) {
      console.error("Error removing ban history:", error);
      alert("Failed to remove ban history—check the console.");
    }
  }
}

async function removeAsMember(communityId, uid) {
  const commRef = doc(db, "communities", communityId);
  const memberRef = doc(db, "communities", communityId, "members", uid);
  const userRef = doc(db, "users", uid);

  try {
    // Fetch community and user data
    const commDoc = await getDoc(commRef);
    const userDoc = await getDoc(userRef);
    if (!commDoc.exists()) {
      alert("Community not found!");
      return;
    }
    if (!userDoc.exists()) {
      alert("User not found!");
      return;
    }

    const commData = commDoc.data();
    const userData = userDoc.data();
    const bannedUsers = commData.bannedUsers || [];
    const isMember = commData.members.includes(uid);
    const userCommunityIds = userData.communityIds || [];

    if (!isMember && !bannedUsers.includes(uid)) {
      alert("User is not a member or banned from this community!");
      return;
    }

    if (commData.creatorId === uid) {
      alert("Cannot remove the community creator!");
      return;
    }

    if (confirm("Remove this user from the community? They’ll need to rejoin to access it again.")) {
      const batch = writeBatch(db);

      // Remove from community members subcollection
      batch.delete(memberRef);

      // Update community doc: remove from members array, lift ban if applicable
      const updatedMembers = commData.members.filter(id => id !== uid);
      batch.update(commRef, {
        members: updatedMembers,
        ...(bannedUsers.includes(uid) ? { [`banStatus.${uid}`]: "lifted" } : {})
      });

      // Remove communityId from user's communityIds
      const updatedCommunityIds = userCommunityIds.filter(id => id !== communityId);
      batch.update(userRef, {
        communityIds: updatedCommunityIds
      });

      await batch.commit();
      alert("User removed from the community successfully!");
      closeModal("viewBannedModal");
      viewBannedUsers(communityId); // Refresh UI

      // If it's the current user, refresh their community list
      if (uid === auth.currentUser?.uid && typeof loadYourCommunities === "function") {
        loadYourCommunities({ ...userData, communityIds: updatedCommunityIds });
      }
    }
  } catch (error) {
    console.error("Error removing member:", error);
    alert("Failed to remove user—check the console for details.");
  }
}

window.viewBannedUsers = viewBannedUsers;
window.removeAsMember = removeAsMember;