import { db, storage } from "./firebaseConfig.js";
import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  deleteDoc,
  orderBy,
  limit,
  startAfter,
  setDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ------------------- GLOBALS ------------------------
const auth = getAuth();
let currentUser = null;

const itemLimit = 10;
let currentFeedPage = 0;
let feedPages = [];
let currentFilter = "all";

// For "Your Products"
let currentProductsPage = 0;
let productPages = [];

// For searching
let cachedFeedDocs = [];

// DOM
const swapsContainer = document.getElementById("swapsContainer");

const filterAll = document.getElementById("filterAll");
const filterItems = document.getElementById("filterItems");
const filterSkills = document.getElementById("filterSkills");
const filterTime = document.getElementById("filterTime");

const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageIndicator = document.getElementById("pageIndicator");

const prevPageBtnBottom = document.getElementById("prevPageBtnBottom");
const nextPageBtnBottom = document.getElementById("nextPageBtnBottom");
const pageIndicatorBottom = document.getElementById("pageIndicatorBottom");

const addSwapForm = document.getElementById("addSwapForm");
const swapPhotosInput = document.getElementById("swapPhotos");

const yourProductsContainer = document.getElementById("yourProductsContainer");
const prevPageProductsBtn = document.getElementById("prevPageProductsBtn");
const nextPageProductsBtn = document.getElementById("nextPageProductsBtn");
const productsPageIndicator = document.getElementById("productsPageIndicator");

// Edit Profile
const editProfileBtn = document.getElementById("editProfileBtn");
const editProfileSection = document.getElementById("editProfileSection");
const editProfileForm = document.getElementById("editProfileForm");
const profileNameInput = document.getElementById("profileName");
const profileLocationInput = document.getElementById("profileLocation");
const profilePhotoInput = document.getElementById("profilePhoto");

// Search
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const clearSearchBtn = document.getElementById("clearSearchBtn");

// Notifications
const newMessageBadge = document.getElementById("newMessageBadge");

// ------------------- AUTH LISTENER ------------------
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    console.log("User is signed in:", user.uid);

    // Attempt to load profile info
    await loadUserProfile(user.uid);

    // Start listening for new messages across relevant swaps
    listenForUnreadMessages();

    // Fetch user products
    resetProductsPagination();
  } else {
    currentUser = null;
    console.log("User is not signed in.");
  }
  // Also reset feed pagination
  resetFeedPagination();
});

// -------------- LOAD USER PROFILE INTO EDIT FORM --------------
async function loadUserProfile(uid) {
  try {
    const userRef = doc(db, "users", uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data();
      profileNameInput.value = data.name || "";
      profileLocationInput.value = data.location || "";
      // no direct way to set file input
    }
  } catch (err) {
    console.error("Error loading user profile:", err);
  }
}

// -------------- EDIT PROFILE HANDLERS --------------
editProfileBtn.addEventListener("click", () => {
  editProfileSection.style.display =
    editProfileSection.style.display === "none" ? "block" : "none";
});

editProfileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) {
    alert("You must sign in to edit profile.");
    return;
  }

  const name = profileNameInput.value.trim();
  const location = profileLocationInput.value.trim();
  const photoFile = profilePhotoInput.files[0];

  let profilePhotoURL = "";
  try {
    if (photoFile) {
      const uniquePath = `profiles/${currentUser.uid}/${Date.now()}_${encodeURIComponent(
        photoFile.name
      )}`;
      const storageRef = ref(storage, uniquePath);
      await uploadBytes(storageRef, photoFile);
      profilePhotoURL = await getDownloadURL(storageRef);
    }
  } catch (err) {
    console.error("Error uploading profile photo:", err);
    alert("Failed to upload profile photo.");
  }

  // Save
  try {
    const userRef = doc(db, "users", currentUser.uid);
    await setDoc(
      userRef,
      {
        name,
        location,
        ...(profilePhotoURL && { profilePhotoURL })
      },
      { merge: true }
    );
    alert("Profile updated!");
  } catch (err) {
    console.error("Error saving profile:", err);
    alert("Failed to save profile.");
  }
});

// ------------------- FILTER EVENTS ------------------
filterAll.addEventListener("click", () => {
  currentFilter = "all";
  setActiveFilter(filterAll);
  resetFeedPagination();
});
filterItems.addEventListener("click", () => {
  currentFilter = "item";
  setActiveFilter(filterItems);
  resetFeedPagination();
});
filterSkills.addEventListener("click", () => {
  currentFilter = "skill";
  setActiveFilter(filterSkills);
  resetFeedPagination();
});
filterTime.addEventListener("click", () => {
  currentFilter = "time";
  setActiveFilter(filterTime);
  resetFeedPagination();
});

function setActiveFilter(activeButton) {
  document.querySelectorAll(".filters button").forEach((btn) => {
    btn.classList.remove("active");
  });
  activeButton.classList.add("active");
}

// ------------------- SEARCH HANDLERS ------------------
searchBtn.addEventListener("click", () => {
  const term = searchInput.value.trim().toLowerCase();
  if (!term) return;
  doSearch(term);
});

clearSearchBtn.addEventListener("click", () => {
  searchInput.value = "";
  resetFeedPagination();
});

function doSearch(term) {
  // naive client-side search
  const filtered = cachedFeedDocs.filter((docSnap) => {
    const data = docSnap.data();
    const title = (data.title || "").toLowerCase();
    const desc = (data.description || "").toLowerCase();
    return title.includes(term) || desc.includes(term);
  });
  // Show them
  swapsContainer.innerHTML = "";
  filtered.forEach((ds) => {
    const swap = ds.data();
    renderSwapCard(swap, ds.id, swapsContainer, false);
  });
}

// ------------------- MAIN FEED PAGINATION ------------------
function resetFeedPagination() {
  currentFeedPage = 0;
  feedPages = [];
  cachedFeedDocs = [];
  loadFeedPage(0);
}

async function loadFeedPage(pageIndex) {
  if (!swapsContainer) return;
  swapsContainer.innerHTML = "...loading...";
  const constraints = [];
  constraints.push(where("status", "in", ["open"])); 
  // only open items in the feed

  if (currentFilter !== "all") {
    constraints.push(where("type", "==", currentFilter));
  }

  constraints.push(orderBy("createdAt", "desc"));
  constraints.push(limit(itemLimit));
  if (pageIndex > 0 && feedPages[pageIndex - 1]) {
    constraints.push(startAfter(feedPages[pageIndex - 1]));
  }

  const qFeed = query(collection(db, "swaps"), ...constraints);
  const snap = await getDocs(qFeed);

  if (pageIndex === 0) {
    cachedFeedDocs = snap.docs;
  } else {
    cachedFeedDocs = [...cachedFeedDocs, ...snap.docs];
  }

  swapsContainer.innerHTML = "";

  if (!snap.empty) {
    feedPages[pageIndex] = snap.docs[snap.docs.length - 1];
  }

  if (snap.empty && pageIndex === 0) {
    swapsContainer.innerHTML = "<p>No items found.</p>";
  } else {
    snap.forEach((docSnap) => {
      const swap = docSnap.data();
      renderSwapCard(swap, docSnap.id, swapsContainer, false);
    });
  }

  currentFeedPage = pageIndex;
  prevPageBtn.disabled = pageIndex === 0;
  prevPageBtnBottom.disabled = pageIndex === 0;
  nextPageBtn.disabled = snap.size < itemLimit;
  nextPageBtnBottom.disabled = snap.size < itemLimit;

  pageIndicator.textContent = `Page ${pageIndex + 1}`;
  pageIndicatorBottom.textContent = `Page ${pageIndex + 1}`;
}

prevPageBtn.addEventListener("click", () => {
  if (currentFeedPage > 0) loadFeedPage(currentFeedPage - 1);
});
nextPageBtn.addEventListener("click", () => {
  loadFeedPage(currentFeedPage + 1);
});
prevPageBtnBottom.addEventListener("click", () => {
  if (currentFeedPage > 0) loadFeedPage(currentFeedPage - 1);
});
nextPageBtnBottom.addEventListener("click", () => {
  loadFeedPage(currentFeedPage + 1);
});

// ------------------- RENDER SWAP CARD ------------------
async function renderSwapCard(swapData, swapId, container, isOwnerView) {
  const card = document.createElement("div");
  card.className = "swap-card";

  // get user info
  let userProfile = {};
  try {
    const userRef = doc(db, "users", swapData.userId);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      userProfile = snap.data();
    }
  } catch (err) {
    console.error("Error fetching user info:", err);
  }

  // user info div
  const userInfoDiv = document.createElement("div");
  userInfoDiv.style.display = "flex";
  userInfoDiv.style.alignItems = "center";
  userInfoDiv.style.gap = "0.5rem";

  const userImg = document.createElement("img");
  userImg.src = userProfile.profilePhotoURL || "https://via.placeholder.com/40";
  userImg.style.width = "60px";
  userImg.style.height = "60px";
  userImg.style.borderRadius = "50%";

  const nameLocDiv = document.createElement("div");
  const nameP = document.createElement("p");
  nameP.style.margin = "0";
  nameP.textContent = userProfile.name || swapData.userId;
  const locP = document.createElement("p");
  locP.style.margin = "0";
  locP.style.fontSize = "0.8rem";
  locP.textContent = userProfile.location || "";

  try {
    const userRef = doc(db, "users", swapData.userId);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      userProfile = snap.data();
    }
  } catch (err) {
    console.error("Error fetching user info:", err);
  }
  
  // Fetch ratings and calculate reputation percentage
  const ratingsRef = collection(db, 'ratings');
  const querySnapshot = await getDocs(query(ratingsRef, where('rateeUid', '==', swapData.userId)));
  const ratings = querySnapshot.docs.map(doc => doc.data());
  
  let repPercentage = 0;
  if (ratings.length > 0) {
    const totalRating = ratings.reduce((acc, rating) => acc + rating.rating, 0);
    repPercentage = (totalRating / ratings.length).toFixed(1);
  } else {
    repPercentage = 0;
  }
  
  // Get closed swaps from user profile
  const closed = userProfile.closedSwaps || 0;
  
  // Create reputation paragraph element
  const repP = document.createElement("p");
  repP.style.margin = "0";
  repP.style.fontSize = "0.8rem";
  repP.textContent = `Reputation: ${repPercentage}% | Closed Swaps: ${closed}`;

  nameLocDiv.appendChild(nameP);
  nameLocDiv.appendChild(locP);
  nameLocDiv.appendChild(repP);

  userInfoDiv.appendChild(userImg);
  userInfoDiv.appendChild(nameLocDiv);

  // Title + interest
  const swapHeader = document.createElement("div");
  swapHeader.className = "swap-header";
  const titleEl = document.createElement("h3");
  titleEl.textContent = swapData.title || "Untitled Swap";
  const interestEl = document.createElement("p");
  const nInterested = (swapData.interestedUsers || []).length;
  interestEl.textContent = `${nInterested} users show interest`;

  swapHeader.appendChild(titleEl);
  swapHeader.appendChild(interestEl);

  const swapDetails = document.createElement("div");
  swapDetails.className = "swap-details";

  const descEl = document.createElement("p");
  descEl.textContent = swapData.description;
  swapDetails.appendChild(descEl);

  const valEl = document.createElement("p");
  valEl.innerHTML = `<strong>Value:</strong> ${swapData.value} points`;
  swapDetails.appendChild(valEl);

  // Carousel
  if (swapData.photoUrls && swapData.photoUrls.length) {
    const carousel = document.createElement("div");
    carousel.className = "photo-carousel";
    let idx = 0;
    const leftArrow = document.createElement("button");
    leftArrow.textContent = "<";
    leftArrow.disabled = true;
    const rightArrow = document.createElement("button");
    rightArrow.textContent = ">";
    const imgEl = document.createElement("img");
    imgEl.src = swapData.photoUrls[0];

    leftArrow.addEventListener("click", () => {
      if (idx > 0) {
        idx--;
        imgEl.src = swapData.photoUrls[idx];
        rightArrow.disabled = false;
        if (idx === 0) leftArrow.disabled = true;
      }
    });
    rightArrow.addEventListener("click", () => {
      if (idx < swapData.photoUrls.length - 1) {
        idx++;
        imgEl.src = swapData.photoUrls[idx];
        leftArrow.disabled = false;
        if (idx === swapData.photoUrls.length - 1) rightArrow.disabled = true;
      }
    });

    if (swapData.photoUrls.length === 1) rightArrow.disabled = true;

    carousel.appendChild(leftArrow);
    carousel.appendChild(imgEl);
    carousel.appendChild(rightArrow);
    swapDetails.appendChild(carousel);
  }

  // "I'm Interested" button if not owner & status = open
  if (currentUser && currentUser.uid !== swapData.userId && swapData.status === "open") {
    const interestBtn = document.createElement("button");
    interestBtn.textContent = "I'm Interested";
    interestBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      expressInterest(swapId);
    });
    swapDetails.appendChild(interestBtn);
  }

  // If ownerView
  if (isOwnerView) {
    const ownerActions = document.createElement("div");
    ownerActions.style.marginTop = "1rem";

    // Edit
    const editBtn = document.createElement("button");
    editBtn.textContent = "Edit Post";
    editBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const newTitle = prompt("New Title:", swapData.title || "");
      if (newTitle === null) return;
      const newDesc = prompt("New Description:", swapData.description || "");
      if (newDesc === null) return;
      const newValStr = prompt("New Value (points):", swapData.value || "0");
      if (newValStr === null) return;
      const newVal = parseInt(newValStr, 10) || 0;
      try {
        await updateDoc(doc(db, "swaps", swapId), {
          title: newTitle, description: newDesc, value: newVal
        });
        alert("Updated!");
        resetProductsPagination();
      } catch (err) {
        console.error(err);
      }
    });
    ownerActions.appendChild(editBtn);

    // Delete
    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete Post";
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const confirmDel = confirm("Are you sure to delete?");
      if (confirmDel) {
        // remove photos
        for (const url of swapData.photoUrls || []) {
          try {
            const fileRef = ref(storage, url);
            await deleteObject(fileRef);
          } catch (err) {
            console.warn("Cannot delete from storage:", err);
          }
        }
        await deleteDoc(doc(db, "swaps", swapId));
        alert("Deleted!");
        resetProductsPagination();
      }
    });
    ownerActions.appendChild(delBtn);

    swapDetails.appendChild(ownerActions);
  }

  // toggle
  card.addEventListener("click", () => {
    if (swapDetails.style.display === "none") {
      swapDetails.style.display = "block";
    } else {
      swapDetails.style.display = "none";
    }
  });
  swapDetails.style.display = "none";

  card.appendChild(userInfoDiv);
  card.appendChild(swapHeader);
  card.appendChild(swapDetails);
  container.appendChild(card);
}

// ------------------- EXPRESS INTEREST ------------------
async function expressInterest(swapId) {
  if (!currentUser) {
    alert("Sign in first.");
    return;
  }
  try {
    const refSwap = doc(db, "swaps", swapId);
    const snap = await getDoc(refSwap);
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.status !== "open") {
      alert("This item is not open for interest.");
      return;
    }
    const arr = data.interestedUsers || [];
    if (!arr.includes(currentUser.uid)) {
      arr.push(currentUser.uid);
      await updateDoc(refSwap, { interestedUsers: arr });
      alert("Interest recorded!");
      loadFeedPage(currentFeedPage);
    } else {
      alert("Already interested.");
    }
  } catch (err) {
    console.error(err);
    alert("Fail to set interest.");
  }
}

// ------------------- "ADD SWAP" FORM ------------------
addSwapForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) {
    alert("Sign in first.");
    return;
  }
  const swapType = document.getElementById("swapType").value;
  const swapTitle = document.getElementById("swapTitle").value;
  const swapDescription = document.getElementById("swapDescription").value;
  const swapValue = document.getElementById("swapValue").value;
  const files = swapPhotosInput.files;

  const photoUrls = [];
  try {
    for (let i = 0; i < Math.min(5, files.length); i++) {
      const file = files[i];
      const uniquePath = `swaps/${currentUser.uid}/${Date.now()}_${encodeURIComponent(file.name)}`;
      const storageRef = ref(storage, uniquePath);
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);
      photoUrls.push(downloadUrl);
    }
  } catch (err) {
    console.error(err);
    alert("Error uploading images.");
    return;
  }

  const newSwap = {
    type: swapType,
    title: swapTitle,
    description: swapDescription,
    value: parseInt(swapValue, 10),
    photoUrls,
    userId: currentUser.uid,
    status: "open",
    createdAt: new Date().toISOString(),
    interestedUsers: []
  };
  try {
    await addDoc(collection(db, "swaps"), newSwap);
    alert("Swap added!");
    addSwapForm.reset();
    resetFeedPagination();
    resetProductsPagination();
  } catch (err) {
    console.error(err);
    alert("Fail to add swap.");
  }
});

// ------------------- YOUR PRODUCTS PAGINATION ------------------
function resetProductsPagination() {
  currentProductsPage = 0;
  productPages = [];
  loadProductsPage(0);
}
async function loadProductsPage(pageIndex) {
  if (!yourProductsContainer) return;
  yourProductsContainer.innerHTML = "...loading...";
  if (!currentUser) {
    yourProductsContainer.innerHTML = "Sign in to see your products.";
    return;
  }
  const constraints = [
    where("userId", "==", currentUser.uid),
    orderBy("createdAt", "desc"),
    limit(itemLimit)
  ];
  if (pageIndex > 0 && productPages[pageIndex - 1]) {
    constraints.push(startAfter(productPages[pageIndex - 1]));
  }
  const qProd = query(collection(db, "swaps"), ...constraints);
  const snap = await getDocs(qProd);
  yourProductsContainer.innerHTML = "";

  if (!snap.empty) {
    productPages[pageIndex] = snap.docs[snap.docs.length - 1];
    snap.forEach((ds) => {
      const data = ds.data();
      renderSwapCard(data, ds.id, yourProductsContainer, true);
    });
  } else {
    if (pageIndex === 0) {
      yourProductsContainer.innerHTML = "<p>No products found.</p>";
    }
  }
  currentProductsPage = pageIndex;
  prevPageProductsBtn.disabled = pageIndex === 0;
  nextPageProductsBtn.disabled = snap.size < itemLimit;
  productsPageIndicator.textContent = `Page ${pageIndex + 1}`;
}
prevPageProductsBtn.addEventListener("click", () => {
  if (currentProductsPage > 0) loadProductsPage(currentProductsPage - 1);
});
nextPageProductsBtn.addEventListener("click", () => {
  loadProductsPage(currentProductsPage + 1);
});

// ------------------- NOTIFICATIONS (UNREAD MESSAGES) ------------------
function listenForUnreadMessages() {
    if (!currentUser) return;
    // We watch all "swaps" that I'm involved with
    const qSwaps = query(collection(db, "swaps"));
    let totalUnread = 0;
    let latestUnread = null; // store the last unread message’s swapId, senderId, etc.
  
    onSnapshot(qSwaps, (snapshot) => {
      // For each docChange (swap), we attach a sub-listener for messages
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added" || change.type === "modified") {
          const swapData = change.doc.data();
          const swapId = change.doc.id;
          const isOwner = (swapData.userId === currentUser.uid);
          const isInterested = (swapData.interestedUsers || []).includes(currentUser.uid);
  
          if (isOwner || isInterested) {
            const msgColl = collection(db, "swaps", swapId, "messages");
            // Attach a sub-listener for the messages in this swap
            onSnapshot(msgColl, (msgSnap) => {
              let unreadCountForThisSwap = 0;
  
              msgSnap.docChanges().forEach((msgChange) => {
                if (msgChange.type === "added") {
                  const mData = msgChange.doc.data();
                  if (!mData.readBy?.includes(currentUser.uid)) {
                    unreadCountForThisSwap++;
                    latestUnread = {
                      swapId,
                      senderId: mData.senderId,
                    };
                  }
                }
              });
  
              if (unreadCountForThisSwap > 0) {
                totalUnread += unreadCountForThisSwap;
                updateUnreadUI(totalUnread, latestUnread);
              }
            });
          }
        }
      });
    });
  }
  
  function updateUnreadUI(total, latestUnread) {
    if (total > 0) {
      newMessageBadge.textContent = `You have ${total} new message(s)! Click here.`;
      newMessageBadge.style.cursor = "pointer";
      newMessageBadge.onclick = () => {
        if (latestUnread) {
          // We can pass the swapId (and possibly the otherUserId) to interests.html via query params
          const url = `interests.html?swapId=${latestUnread.swapId}&senderId=${latestUnread.senderId}`;
          window.location.href = url;
        } else {
          // fallback: just go to interests page
          window.location.href = "interests.html";
        }
      };
    } else {
      newMessageBadge.textContent = "";
      newMessageBadge.onclick = null;
    }
  }