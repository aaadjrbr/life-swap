import { auth, doc, setDoc, getDoc, updateDoc, addDoc, runTransaction, collection, query, limit, getDocs, deleteDoc, where, orderBy, startAfter, db, deleteField } from './firebaseConfig.js';
import { communityId } from './main.js';
import { liftBan, removeBanHistory } from './banManager.js';

export { viewProfile, banUser };

async function viewProfile(uid) {
  if (!communityId) {
    console.error("viewProfile: communityId is undefined! URL:", window.location.href);
    alert("Community ID is missing—can’t load profile!");
    return;
  }
  console.log("viewProfile called with:", { uid, communityId });

  const modal = document.getElementById("viewProfileModal");
  const nameEl = document.getElementById("profileName");
  const photoEl = document.getElementById("profilePhoto");
  const detailsEl = document.getElementById("profileDetails");
  const actionsEl = document.getElementById("profileActions");

  nameEl.textContent = "Loading...";
  photoEl.src = "https://firebasestorage.googleapis.com/v0/b/life-swap-6065e.firebasestorage.app/o/static%2Fprofile-pic-green.webp?alt=media&token=cdba35d8-86b1-496a-850a-88920da9cda4";
  detailsEl.innerHTML = '<div class="loading">Loading...</div>';
  actionsEl.innerHTML = '<div class="loading"><img style="width: 40px; height: 40px;" src="https://firebasestorage.googleapis.com/v0/b/life-swap-6065e.firebasestorage.app/o/static%2Floading-img-animated.gif?alt=media&token=475e84b9-605a-4b6a-9807-49192a090c8c"></div>';

  document.querySelectorAll(".modal:not(#viewProfileModal)").forEach(m => {
    m.style.display = "none";
    m.classList.add("hidden");
  });
  modal.style.display = "flex";
  modal.classList.remove("hidden");

  if (typeof auth === "undefined") {
    console.error("Firebase auth is not defined. Ensure Firebase is initialized.");
    actionsEl.innerHTML = "<p>Error: Authentication system not loaded.</p>";
    return;
  }

  const currentUser = await new Promise((resolve, reject) => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      unsubscribe();
      resolve(user);
    });
    setTimeout(() => reject(new Error("Auth check timed out")), 5000);
  }).catch((error) => {
    console.error("Auth check failed:", error);
    actionsEl.innerHTML = "<p>Error: Couldn’t verify user—try refreshing.</p>";
    return null;
  });

  if (!currentUser) {
    console.error("No authenticated user found. User must be signed in.");
    actionsEl.innerHTML = "<p>Please sign in to view profiles.</p>";
    return;
  }

  let userData, commData;
  try {
    [userData, commData] = await Promise.all([
      fetchUserData(uid),
      getCommData(true) // Force fresh fetch
    ]);
  } catch (error) {
    console.error("Error fetching profile data:", error);
    actionsEl.innerHTML = "<p>Failed to load profile—try again later.</p>";
    return;
  }

  const isCreator = commData.creatorId === currentUser.uid;
  const isAdmin = commData.admins?.includes(currentUser.uid) || false;
  const isSelf = uid === currentUser.uid;
  const isProfileAdmin = commData.admins?.includes(uid) || commData.creatorId === uid;

  console.log("Admin checks:", { isCreator, isAdmin, currentUserUid: currentUser.uid, commAdmins: commData.admins, creatorId: commData.creatorId });

  const userRef = doc(db, "users", uid);
  const userDoc = await getDoc(userRef);
  if (!userDoc.exists()) {
    console.error(`User ${uid} not found in Firestore`);
    actionsEl.innerHTML = "<p>User not found.</p>";
    return;
  }
  const userDocData = userDoc.data();

  const isVerified = userDocData && 
    userDocData.username?.trim() && 
    userDocData.name?.trim() && 
    userDocData.city?.trim() && 
    userDocData.phone?.trim() && 
    userDocData.profilePhoto?.trim() && 
    userDocData.email?.trim();

  const followerCount = userDocData.followerCount || 0;
  const followingCount = userDocData.followingCount || 0;
  const joinedAt = userDocData.joinedAt ? new Date(userDocData.joinedAt.toDate()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : "N/A";

  const followersRef = collection(db, "users", uid, "followers");
  const followingQuery = query(followersRef, where("followerId", "==", currentUser.uid));
  let isFollowing = false;
  try {
    const followingSnapshot = await getDocs(followingQuery);
    isFollowing = !followingSnapshot.empty;
  } catch (error) {
    console.error("Error fetching follow status:", error);
    if (error.name === "BloomFilterError") {
      console.warn("BloomFilter error, retrying:", error);
      const retrySnapshot = await getDocs(followingQuery);
      isFollowing = !retrySnapshot.empty;
    }
  }
  console.log(`Is following ${uid}? ${isFollowing}`);

  const requestsRef = collection(db, "users", uid, "profileRequests");
  const requestQ = query(requestsRef, where("requesterId", "==", currentUser.uid));
  let request, requestId;
  try {
    const requestSnapshot = await getDocs(requestQ);
    request = requestSnapshot.docs[0]?.data();
    requestId = requestSnapshot.docs[0]?.id;
  } catch (error) {
    console.error("Error fetching profile request:", error);
  }

  const nameContent = `${userData.name || "Unknown"} (🤝 ${userData.swaps || 0} swaps)${isVerified ? ' <span title="Users verified have completed their profile checks." class="verified-badge">Verified</span>' : ''}`;
  const photoSrc = userData.profilePhoto || "https://firebasestorage.googleapis.com/v0/b/life-swap-6065e.firebasestorage.app/o/static%2Fprofile-pic-green.webp?alt=media&token=cdba35d8-86b1-496a-850a-88920da9cda4";
  
  let detailsContent = `
    <p id="followerCount">Followers: ${followerCount} / Following: ${followingCount}</p>
    <p>Member since: ${joinedAt}</p>
    ${isProfileAdmin ? '<span class="admin-tag">Admin</span>' : ''}
  `;
  let actionsContent = "";

  if (!isSelf) {
    actionsContent += `
      <button id="followBtn" class="${isFollowing ? 'unfollow' : 'follow'}" data-uid="${uid}">
        ${isFollowing ? 'Unfollow' : 'Follow'}
      </button>
    `;
  }

  if (isSelf || (request && request.status === "accepted") || isCreator || isAdmin) {
    detailsContent += `
      <p>Email: ${userData.email || "Not set"}</p>
      <p>City: ${userData.city || "Not set"}</p>
      <p>Phone: ${userData.phone || "Not set"}</p>
    `;
    if (request && request.status === "accepted" && !isSelf && !isAdmin && !isCreator) {
      actionsContent += `<button class="revoke-btn" id="revokeProfileBtn" data-request-id="${requestId}">Revoke Profile Access</button>`;
    }
    actionsContent += `<button id="chatBtn" data-uid="${uid}">Chat</button>`;
  } else if (request && request.status === "pending") {
    actionsContent += `<button class="request-btn pending" id="requestProfileBtn" data-request-id="${requestId}" disabled>Pending...</button>`;
  } else if (!isSelf) {
    actionsContent += `<button class="request-btn" id="requestProfileBtn">Ask to see full profile</button>`;
  }

  // Admin/Creator actions with ban status logic
  const bannedUsers = commData.bannedUsers || [];
  const banStatus = commData.banStatus || {};
  const isBannedActive = bannedUsers.includes(uid) && banStatus[uid] === "active";
  const isBanLifted = bannedUsers.includes(uid) && banStatus[uid] === "lifted";
  const hasNoBanHistory = !bannedUsers.includes(uid);
  const members = commData.members || [];
  const admins = commData.admins || [];

  if (isCreator) {
    if (members.includes(uid) && !admins.includes(uid) && uid !== commData.creatorId) {
      actionsContent += `<button class="admin-btn" id="makeAdminBtn">Make Admin</button>`;
    }
    if (members.includes(uid) && admins.includes(uid) && uid !== commData.creatorId) {
      actionsContent += `<button class="remove-admin-btn" id="removeAdminBtn">Remove Admin</button>`;
    }
    if (members.includes(uid) && uid !== commData.creatorId) {
      if (hasNoBanHistory) {
        actionsContent += `<button class="ban-btn" id="banUserBtn">Ban User</button>`;
      } else if (isBanLifted) {
        actionsContent += `<button class="reinstate-ban-btn" id="reinstateBanBtn">Reinstate Ban</button>`;
      } else if (isBannedActive) {
        actionsContent += `<button class="unban-btn" id="unbanUserBtn">Unban User</button>`;
      }
    }
  } else if (isAdmin && uid !== commData.creatorId) {
    if (members.includes(uid)) {
      if (hasNoBanHistory) {
        actionsContent += `<button class="ban-btn" id="banUserBtn">Ban User</button>`;
      } else if (isBanLifted) {
        actionsContent += `<button class="reinstate-ban-btn" id="reinstateBanBtn">Reinstate Ban</button>`;
      } else if (isBannedActive) {
        actionsContent += `<button class="unban-btn" id="unbanUserBtn">Unban User</button>`;
      }
    }
  }

  nameEl.innerHTML = nameContent;
  photoEl.src = photoSrc;
  detailsEl.innerHTML = detailsContent;
  actionsEl.innerHTML = actionsContent;

  photoEl.style.cursor = "pointer";
  photoEl.addEventListener("click", () => {
    let overlay = document.getElementById("profilePhotoOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "profilePhotoOverlay";
      overlay.className = "photo-overlay";
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<img src="${photoEl.src}" alt="Enlarged Profile Photo" class="enlarged-photo">`;
    overlay.style.display = "flex";
    overlay.addEventListener("click", () => overlay.style.display = "none");
  });

  const attachListener = (id, callback) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", callback);
    else console.warn(`Button ${id} not found in DOM`);
  };

  attachListener("requestProfileBtn", () => requestProfileAccess(uid));
  attachListener("makeAdminBtn", async () => {
    await makeAdmin(communityId, uid);
    await viewProfile(uid);
  });
  attachListener("removeAdminBtn", async () => {
    await removeAdmin(communityId, uid);
    await viewProfile(uid);
  });
  attachListener("banUserBtn", async () => {
    await banUser(communityId, uid);
    await viewProfile(uid);
  });
  attachListener("reinstateBanBtn", async () => {
    await reinstateBan(communityId, uid);
    await viewProfile(uid);
  });
  attachListener("unbanUserBtn", async () => {
    await liftBan(communityId, uid);
    await viewProfile(uid);
  });
  attachListener("revokeProfileBtn", () => revokeProfileAccess(uid, document.getElementById("revokeProfileBtn")?.dataset.requestId));
  attachListener("chatBtn", () => {
    if (typeof window.openChat === "function") {
      closeModal("viewProfileModal");
      window.openChat(uid, communityId);
    } else {
      console.error("Chat functionality not loaded yet!");
      alert("Chat system isn’t ready. Try again in a sec.");
    }
  });
  attachListener("followBtn", async () => {
    console.log("Follow button clicked for UID:", uid);
    await toggleFollow(uid, document.getElementById("followBtn"));
    await viewProfile(uid);
  });
}

async function banUser(communityId, uid) {
  if (!communityId || typeof communityId !== "string") {
    console.error("banUser: Invalid communityId:", communityId);
    alert("Can’t ban user—community ID is missing!");
    return;
  }
  console.log("banUser called with:", { communityId, uid });

  const commRef = doc(db, "communities", communityId);
  let commData;
  try {
    const commDoc = await getDoc(commRef);
    if (!commDoc.exists()) throw new Error("Community not found");
    commData = commDoc.data();
  } catch (error) {
    console.error("Error fetching community data:", error);
    alert("Failed to load community data—try again.");
    return;
  }

  const bannedUsers = commData.bannedUsers || [];
  if (bannedUsers.includes(uid)) {
    alert("User is already banned or has ban history!");
    return;
  }
  if (uid === commData.creatorId) {
    alert("Cannot ban the community creator!");
    return;
  }

  const banReason = prompt("Please enter a reason for banning this user (e.g., 'Posting illegal things...'):");
  if (banReason === null || banReason.trim() === "") {
    alert("Ban canceled - no reason provided.");
    return;
  }

  try {
    await updateDoc(commRef, {
      bannedUsers: [...bannedUsers, uid],
      [`banStatus.${uid}`]: "active",
      [`banReasons.${uid}`]: banReason.trim()
    });
    resetCommDataCache();
    alert("User banned successfully!");
  } catch (error) {
    console.error("Error banning user:", error);
    alert("Failed to ban user—check the console.");
  }
}

async function reinstateBan(communityId, uid) {
  if (!communityId || typeof communityId !== "string") {
    console.error("reinstateBan: Invalid communityId:", communityId);
    alert("Can’t reinstate ban—community ID is missing!");
    return;
  }
  console.log("reinstateBan called with:", { communityId, uid });

  const commRef = doc(db, "communities", communityId);
  let commData;
  try {
    const commDoc = await getDoc(commRef);
    if (!commDoc.exists()) throw new Error("Community not found");
    commData = commDoc.data();
  } catch (error) {
    console.error("Error fetching community data:", error);
    alert("Failed to load community data—try again.");
    return;
  }

  const bannedUsers = commData.bannedUsers || [];
  const banStatus = commData.banStatus || {};
  if (!bannedUsers.includes(uid) || banStatus[uid] !== "lifted") {
    alert("User has no lifted ban to reinstate!");
    return;
  }
  if (uid === commData.creatorId) {
    alert("Cannot reinstate ban on the community creator!");
    return;
  }

  if (confirm("Reinstate ban on this user?")) {
    try {
      await updateDoc(commRef, {
        [`banStatus.${uid}`]: "active"
      });
      resetCommDataCache();
      alert("Ban reinstated successfully!");
    } catch (error) {
      console.error("Error reinstating ban:", error);
      alert("Failed to reinstate ban—check the console.");
    }
  }
}

async function toggleFollow(targetUid, button) {
  console.log("toggleFollow called with targetUid:", targetUid);

  const currentUser = auth.currentUser;
  if (!currentUser) {
    console.error("No current user found in toggleFollow!");
    alert("You must be signed in to follow/unfollow.");
    return;
  }

  const followersRef = collection(db, "users", targetUid, "followers");
  const followerDocRef = doc(followersRef, currentUser.uid);
  const followingRef = collection(db, "users", currentUser.uid, "following");
  const followingDocRef = doc(followingRef, targetUid);
  const followerCountEl = document.getElementById("followerCount");

  if (!followerCountEl) {
    console.error("Follower count element not found in DOM!");
    return;
  }

  const currentCountText = followerCountEl.textContent.match(/\d+/)?.[0] || "0";
  let currentFollowerCount = parseInt(currentCountText, 10);

  let isFollowing;
  try {
    const followingSnapshot = await getDoc(followingDocRef);
    isFollowing = followingSnapshot.exists();
    console.log("Is following?", isFollowing);
  } catch (error) {
    console.error("Error fetching following snapshot:", error);
    alert("Failed to check follow status. Try again.");
    return;
  }

  try {
    if (isFollowing) {
      console.log("Unfollowing...");
      await Promise.all([deleteDoc(followerDocRef), deleteDoc(followingDocRef)]);
      button.textContent = "Follow";
      button.classList.remove("unfollow");
      button.classList.add("follow");
      currentFollowerCount = Math.max(0, currentFollowerCount - 1);
      followerCountEl.textContent = `Followers: ${currentFollowerCount}`;
    } else {
      console.log("Following...");
      const currentUserData = await fetchCurrentUserData().catch(() => ({ name: "Someone", username: "Unknown" }));
      const followData = {
        followerId: currentUser.uid,
        username: currentUserData.username || currentUserData.name || "Unknown",
        followedAt: new Date(),
      };
      await Promise.all([
        setDoc(followerDocRef, followData),
        setDoc(followingDocRef, {
          followingId: targetUid,
          username: (await fetchUserData(targetUid))?.username || "Unknown",
          followedAt: new Date(),
        })
      ]);
      button.textContent = "Unfollow";
      button.classList.remove("follow");
      button.classList.add("unfollow");
      currentFollowerCount += 1;
      followerCountEl.textContent = `Followers: ${currentFollowerCount}`;

      try {
        await addDoc(collection(db, "users", targetUid, "notifications"), {
          type: "follow",
          message: `${currentUserData.name || "Someone"} followed you!`,
          followerId: currentUser.uid,
          timestamp: new Date(),
          seen: false,
        });
        const targetRef = doc(db, "users", targetUid);
        await runTransaction(db, async (transaction) => {
          const targetDoc = await transaction.get(targetRef);
          const currentCount = targetDoc.exists() ? targetDoc.data().unseenCount || 0 : 0;
          transaction.set(targetRef, { unseenCount: currentCount + 1, lastUpdated: new Date() }, { merge: true });
        });
        setTimeout(() => updateNotificationBadge(targetUid, true), 1000);
      } catch (error) {
        console.error("Error sending notification:", error);
      }
    }
    console.log("Follow/unfollow completed successfully");
  } catch (error) {
    console.error("Error in follow/unfollow operation:", error);
    alert("Failed to update follow status. Please try again.");
    button.textContent = isFollowing ? "Unfollow" : "Follow";
    button.classList.toggle("follow", !isFollowing);
    button.classList.toggle("unfollow", isFollowing);
    followerCountEl.textContent = `Followers: ${currentCountText}`;
  }
}

async function makeAdmin(communityId, uid) {
  if (!communityId || typeof communityId !== "string") {
    console.error("makeAdmin: Invalid communityId:", communityId);
    alert("Can’t make admin—community ID is missing!");
    return;
  }
  console.log("makeAdmin called with:", { communityId, uid });

  try {
    const commData = await getCommData(true);
    const commRef = doc(db, "communities", communityId);
    const admins = commData.admins || [];
    const members = commData.members || [];

    if (!admins.includes(uid) && members.includes(uid) && uid !== commData.creatorId) {
      await updateDoc(commRef, { admins: [...admins, uid] });
      resetCommDataCache();
      alert("User is now an admin!");
    } else {
      alert("User not found, already an admin, or is the creator!");
    }
  } catch (error) {
    console.error("Error making admin:", error);
    alert("Failed to make admin—check the console.");
  }
}

async function removeAdmin(communityId, uid) {
  if (!communityId || typeof communityId !== "string") {
    console.error("removeAdmin: Invalid communityId:", communityId);
    alert("Can’t remove admin—community ID is missing!");
    return;
  }
  console.log("removeAdmin called with:", { communityId, uid });

  try {
    const commData = await getCommData(true);
    const commRef = doc(db, "communities", communityId);
    const admins = commData.admins || [];

    if (admins.includes(uid) && uid !== commData.creatorId) {
      await updateDoc(commRef, { admins: admins.filter(a => a !== uid) });
      resetCommDataCache();
      alert("User admin status removed!");
    } else {
      alert("User not an admin or is the creator!");
    }
  } catch (error) {
    console.error("Error removing admin:", error);
    alert("Failed to remove admin—check the console.");
  }
}

async function requestProfileAccess(targetId) {
  const user = auth.currentUser;
  if (!user) {
    alert("You must be signed in to request profile access!");
    return;
  }

  const requestBtn = document.getElementById("requestProfileBtn");
  if (!requestBtn) return;

  requestBtn.textContent = "Pending...";
  requestBtn.classList.add("pending");
  requestBtn.disabled = true;

  try {
    const requesterData = await fetchCurrentUserData();
    const requestsRef = collection(db, "users", targetId, "profileRequests");
    const requestDoc = await addDoc(requestsRef, {
      requesterId: user.uid,
      status: "pending",
      createdAt: new Date()
    });

    requestBtn.dataset.requestId = requestDoc.id;

    await addDoc(collection(db, "users", targetId, "notifications"), {
      type: "profile_request",
      message: `${requesterData.name || "Someone"} wants to see your full profile!`,
      requestId: requestDoc.id,
      communityId: communityId,
      timestamp: new Date(),
      seen: false
    });

    const targetRef = doc(db, "users", targetId);
    await runTransaction(db, async (transaction) => {
      const targetDoc = await transaction.get(targetRef);
      const currentCount = targetDoc.exists() ? targetDoc.data().unseenCount || 0 : 0;
      transaction.set(targetRef, { unseenCount: currentCount + 1, lastUpdated: new Date() }, { merge: true });
    });

    setTimeout(() => updateNotificationBadge(targetId, true), 1000);
    alert("Profile access requested!");
    await viewProfile(targetId);
  } catch (error) {
    console.error("Error requesting profile access:", error);
    alert("Failed to request profile access—try again.");
    requestBtn.textContent = "Ask to see full profile";
    requestBtn.classList.remove("pending");
    requestBtn.disabled = false;
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = "none";
    modal.classList.add("hidden");
  }
}

window.viewProfile = viewProfile;