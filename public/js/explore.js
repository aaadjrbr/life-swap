// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, writeBatch, setDoc, getDocs, where, orderBy, onSnapshot, updateDoc, query, doc, getDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

// Firebase config
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
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);
const functions = getFunctions(app, 'us-central1');

// Authentication Check
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("You must be logged in to use Life Swap!");
    window.location.href = "/login.html"; // Redirect to login page
  } else {
    const userRef = doc(db, "users", user.uid);
    const userDoc = await getDoc(userRef);

    if (!userDoc.exists()) {
      // New user: Create a default document
      await setDoc(userRef, {
        name: user.displayName || "New User", // Default to Firebase display name or "New User"
        bio: "",
        city: "", // Empty city
        profilePhoto: null, // No profile photo
        joinedAt: new Date(), // Track when the user joined
      });
      console.log("User document created for new user.");
    } else {
      console.log("User document already exists.");
    }

    // Load data after ensuring the document exists
    loadPosts();
    loadOffers();
    loadYourPosts();
    setupNotificationListener(); // Start real-time listener
  }
});

// Logout Function
function logout() {
  signOut(auth).then(() => {
    alert("You have been logged out!");
    window.location.href = "/login.html";
  });
}

let cityData = {}; // To store JSON data

async function fetchCityData() {
  try {
    const response = await fetch("./js/cities.json");
    if (!response.ok) throw new Error("Failed to fetch city data");

    cityData = await response.json();
  } catch (error) {
    console.error("Error loading city data:", error);
  }
}

// Handle input for suggestions
function setupAutocomplete(inputId, suggestionsId) {
  const inputField = document.getElementById(inputId);
  const suggestionsContainer = document.getElementById(suggestionsId);

  inputField.addEventListener("input", () => {
    const query = inputField.value.toLowerCase();
    suggestionsContainer.innerHTML = ""; // Clear previous suggestions

    if (query.length === 0) {
      suggestionsContainer.style.display = "none";
      return;
    }

    // Flatten cityData into an array of cities
    const allCities = Object.values(cityData).flat();

    // Filter cities based on the query
    const matchingCities = allCities.filter((city) =>
      city.toLowerCase().includes(query)
    );

    if (matchingCities.length === 0) {
      suggestionsContainer.style.display = "none";
      return;
    }

    // Populate suggestions
    matchingCities.forEach((city) => {
      const suggestion = document.createElement("div");
      suggestion.textContent = city;
      suggestion.addEventListener("click", () => {
        inputField.value = city; // Set selected city
        suggestionsContainer.innerHTML = ""; // Clear suggestions
        suggestionsContainer.style.display = "none";
      });
      suggestionsContainer.appendChild(suggestion);
    });

    suggestionsContainer.style.display = "block";
  });

  // Hide suggestions if clicked outside
  document.addEventListener("click", (event) => {
    if (!suggestionsContainer.contains(event.target) && event.target !== inputField) {
      suggestionsContainer.style.display = "none";
    }
  });
}

// Initialize autocomplete for both fields
document.addEventListener("DOMContentLoaded", async () => {
  await fetchCityData();
  setupAutocomplete("city", "citySuggestions"); // For post creation
  setupAutocomplete("filterCity", "filterCitySuggestions"); // For filters
  setupAutocomplete("profileCity", "profileCitySuggestions"); // For profile editor
});

// Handle Post Creation
document.getElementById("postForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const hashtagsField = document.getElementById("hashtags");
  // Clean the hashtags input to remove any trailing comma
  hashtagsField.value = hashtagsField.value.replace(/,\s*$/, "");

  const title = document.getElementById("title").value.trim();
  const description = document.getElementById("description").value.trim();
  const postType = document.getElementById("postType").value;
  const category = document.getElementById("category").value;
  const city = document.getElementById("city").value.trim();
  const distance = parseInt(document.getElementById("distance").value) || 0;

  // New field: Desired trade
  const desiredTrade = document.getElementById("desiredTrade").value.trim(); // Ensure this input exists in your HTML form

  // Clean and prepare hashtags
  const hashtags = hashtagsField.value
    .split(",")
    .map((tag) => `#${tag.trim().toLowerCase().replace(/^#/, "")}`)
    .filter((tag) => tag); // Remove empty tags

  const images = document.getElementById("images").files;

  const user = auth.currentUser;
  if (!user) {
    alert("You must be logged in to post!");
    return;
  }

  const imageUrls = [];
  for (const image of images) {
    const imageRef = ref(storage, `images/${user.uid}/${image.name}`);
    await uploadBytes(imageRef, image);
    const url = await getDownloadURL(imageRef);
    imageUrls.push(url);
  }

  await addDoc(collection(db, "posts"), {
    title,
    description,
    desiredTrade, // Include the new field in the Firestore document
    type: postType,
    category,
    city, // User-selected city
    distanceFromCity: distance, // Distance from the selected city
    hashtags,
    imageUrls,
    userId: user.uid,
    timestamp: new Date(),
  });

  alert("Post created successfully!");
  document.getElementById("postForm").reset();
  loadPosts();
});

// Load Posts
async function loadPosts(filterType = "", filterHashtags = [], filterCity = "", maxDistance = 0) {
  const postGrid = document.getElementById("postGrid");
  postGrid.innerHTML = "Loading...";

  let postsQuery = query(collection(db, "posts"));

  // Filter by type
  if (filterType) {
    postsQuery = query(postsQuery, where("type", "==", filterType));
  }

  // Filter by hashtags
  if (filterHashtags.length > 0) {
    postsQuery = query(postsQuery, where("hashtags", "array-contains-any", filterHashtags));
  }

  const querySnapshot = await getDocs(postsQuery);

  const filteredPosts = [];
  for (const postDoc of querySnapshot.docs) {
    const post = postDoc.data();

    // Apply city filter
    if (filterCity && post.city !== filterCity) {
      continue;
    }

    // Apply distance filter
    if (maxDistance > 0 && post.distanceFromCity > maxDistance) {
      continue;
    }

    // Fetch the user rating for the post owner
    const userRatingsQuery = query(collection(db, "ratings"), where("rateeId", "==", post.userId));
    const userRatingsSnapshot = await getDocs(userRatingsQuery);

    const ratings = [];
    userRatingsSnapshot.forEach((ratingDoc) => ratings.push(ratingDoc.data().rating));
    const averageRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b) / ratings.length).toFixed(1) : "No ratings";

    // Add the post to the filtered results
    filteredPosts.push({
      id: postDoc.id,
      ...post,
      averageRating,
      ratingCount: ratings.length,
    });
  }

  // Display posts
  if (filteredPosts.length === 0) {
    postGrid.innerHTML = "<p>No posts match your filter criteria.</p>";
    return;
  }

  postGrid.innerHTML = ""; // Clear the grid
  filteredPosts.forEach((post) => {
    const imageUrl = post.imageUrls && post.imageUrls[0] 
      ? post.imageUrls[0] 
      : "https://upload.wikimedia.org/wikipedia/commons/a/a3/Image-not-found.png?20210521171500"; // Placeholder image if none exists

    const postDate = new Date(post.timestamp.toDate()).toLocaleString(); // Format timestamp

    const postCard = document.createElement("div");
    postCard.classList.add("post-card"); // Add class for styling
    postCard.innerHTML = `
      <div class="post-header">
        <img src="${imageUrl}" alt="${post.title}" class="post-image" />
        <div class="post-info">
          <h3 class="post-title">${post.title}</h3>
          <p class="post-city">${post.city} (${post.distanceFromCity} miles away)</p>
          <p class="post-date">Posted on: ${postDate}</p>
          <p class="post-rating">★ ${post.averageRating} (${post.ratingCount} reviews)</p>
        </div>
      </div>
      <button onclick="viewDetails('${post.id}')">View Details</button>
    `;
    postGrid.appendChild(postCard);
  });
}

async function normalizeCityNames() {
  const postsQuery = query(collection(db, "posts"));
  const querySnapshot = await getDocs(postsQuery);

  querySnapshot.forEach(async (postDoc) => {
    const post = postDoc.data();
    const normalizedCity = post.city.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); // Capitalize first letter
    if (post.city !== normalizedCity) {
      await updateDoc(doc(db, "posts", postDoc.id), { city: normalizedCity });
      console.log(`Updated city for post: ${postDoc.id}`);
    }
  });
}

normalizeCityNames();

function applyFilters(filterType = "", filterHashtags = "") {
  const selectedFilterType = document.getElementById("filterType").value || filterType;
  const rawHashtags = document.getElementById("filterHashtag").value;
  const selectedCity = document.getElementById("filterCity").value;
  const maxDistance = parseInt(document.getElementById("filterDistance").value, 10) || 0;

  // Process hashtags
  const filterHashtagsArray = rawHashtags
    .split(",")
    .map((tag) => {
      const trimmed = tag.trim().toLowerCase();
      return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    })
    .filter((tag) => tag.length > 1);

  if (filterHashtags) {
    const clickedHashtag = decodeURIComponent(filterHashtags).trim();
    if (!filterHashtagsArray.includes(clickedHashtag)) {
      filterHashtagsArray.push(clickedHashtag);
    }
  }

  console.log("Applying filters:", {
    filterType: selectedFilterType,
    filterCity: selectedCity,
    filterDistance: maxDistance,
    filterHashtags: filterHashtagsArray,
  });

  // Pass all filters to `loadPosts`
  loadPosts(selectedFilterType, filterHashtagsArray, selectedCity, maxDistance);
}

let allHashtags = [];

// Fetch all existing hashtags from Firebase on page load
async function fetchAllHashtags() {
  const postsQuery = query(collection(db, "posts"));
  const querySnapshot = await getDocs(postsQuery);

  allHashtags = []; // Reset hashtags
  querySnapshot.forEach((doc) => {
    const post = doc.data();
    if (post.hashtags && Array.isArray(post.hashtags)) {
      allHashtags.push(...post.hashtags); // Collect all hashtags
    }
  });

  // Remove duplicates
  allHashtags = [...new Set(allHashtags.map(tag => tag.toLowerCase()))];
}
fetchAllHashtags(); // Call this on page load

// Suggest hashtags as user types
function suggestHashtags(inputValue) {
  const suggestionsContainer = document.getElementById("hashtagSuggestions");
  suggestionsContainer.innerHTML = ""; // Clear previous suggestions

  const lastHashtag = inputValue.split(",").pop().trim(); // Get the last part being typed

  if (!lastHashtag) return; // If nothing is typed, do nothing

  // Filter matching hashtags
  const matches = allHashtags.filter((tag) =>
    tag.startsWith(`#${lastHashtag.toLowerCase()}`)
  );

  // Display suggestions
  matches.forEach((tag) => {
    const suggestionDiv = document.createElement("div");
    suggestionDiv.textContent = tag;
    suggestionDiv.className = "suggestion-bubble";
    suggestionDiv.onclick = () => addHashtagToInput(tag); // Add to input on click
    suggestionsContainer.appendChild(suggestionDiv);
  });
}

// Replace input value with the selected suggestion
function addHashtagToInput(selectedTag) {
  const inputField = document.getElementById("hashtags");
  const currentInput = inputField.value;
  const hashtags = currentInput.split(",").map((tag) => tag.trim());

  hashtags[hashtags.length - 1] = selectedTag; // Replace last typed part with selected tag

  inputField.value = hashtags.join(", ") + ", "; // Add comma and space
  document.getElementById("hashtagSuggestions").innerHTML = ""; // Clear suggestions
}

// Remove trailing commas on blur
document.getElementById("hashtags").addEventListener("blur", (e) => {
  // Remove trailing commas when the field loses focus
  e.target.value = e.target.value.replace(/,\s*$/, "");
});

let debounceTimeout;

function debouncedSuggestHashtags(inputValue) {
  clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(() => suggestHashtags(inputValue), 300); // 300ms delay
}

// View Post Details
async function viewDetails(postId, hideOfferSwap = false) {
  const modal = document.getElementById("modal");
  const modalContent = document.getElementById("modalContent");

  const postDoc = await getDoc(doc(db, "posts", postId));
  const post = postDoc.data();

  // Fetch ratings for the post user
  const ratingsQuery = query(collection(db, "ratings"), where("rateeId", "==", post.userId));
  const ratingsSnapshot = await getDocs(ratingsQuery);

  let totalRating = 0;
  let ratingCount = 0;

  ratingsSnapshot.forEach((doc) => {
    const ratingData = doc.data();
    totalRating += ratingData.rating; // Add each rating
    ratingCount += 1; // Increment the count
  });

  // Calculate average rating
  const averageRating = ratingCount > 0 ? (totalRating / ratingCount).toFixed(1) : "No reviews";

  if (!post) {
    alert("Post not found.");
    return;
  }

  // Fetch user details
  const userDoc = await getDoc(doc(db, "users", post.userId));
  const user = userDoc.exists() ? userDoc.data() : { name: "Unknown User", profilePhoto: "default-profile-photo.jpg" };

  let currentIndex = 0;

  function updateCarousel() {
    modalContent.querySelector(".carousel-image").src = post.imageUrls[currentIndex];
  }

  modalContent.innerHTML = `
    <div class="post-details">
      <h3 class="post-title">${post.title}</h3>
      <div class="carousel">
        <button class="carousel-button" id="prev">←</button>
        <img src="${post.imageUrls[0]}" class="carousel-image" alt="Image" />
        <button class="carousel-button" id="next">→</button>
      </div>
      <p class="post-description">${post.description}</p>
      <p class="post-category"><strong>Category:</strong> ${post.category}</p>
      <p class="post-location"><strong>Location:</strong> ${post.city} (${post.distanceFromCity || 0} miles away)</p>
      <div class="user-info">
        <img src="${user.profilePhoto}" alt="${user.name}" class="profile-photo" />
        <p class="post-rating">★ ${averageRating} (${ratingCount} reviews)</p>
        <p class="user-name">
          <strong>Posted by:</strong> 
          <span class="clickable-author" onclick="viewProfile('${post.userId}')">${user.name}</span>
        </p>
      </div>
      ${
        !hideOfferSwap
          ? `<button class="offer-swap-btn" onclick="openOfferSwapModal('${postId}', '${post.title}')">Offer Swap</button>`
          : ""
      }
      <button class="close-modal-btn" onclick="closeModal()">Close</button>
    </div>
  `;

  // Carousel navigation
  document.getElementById("prev").addEventListener("click", () => {
    currentIndex = (currentIndex - 1 + post.imageUrls.length) % post.imageUrls.length;
    updateCarousel();
  });

  document.getElementById("next").addEventListener("click", () => {
    currentIndex = (currentIndex + 1) % post.imageUrls.length;
    updateCarousel();
  });

  modal.classList.remove("hidden");
}

// Profile Editing
async function openProfileEditor() {
  const user = auth.currentUser;
  if (!user) {
    alert("You must be logged in to edit your profile!");
    return;
  }

  const userRef = doc(db, "users", user.uid);
  const userDoc = await getDoc(userRef);

  if (userDoc.exists()) {
    const userData = userDoc.data();
    document.getElementById("userName").value = userData.name || "";
    document.getElementById("userBio").value = userData.bio || "";
    document.getElementById("profileCity").value = userData.city || "";
    document.getElementById("instagram").value = userData.instagram || ""; // Populate Instagram
    document.getElementById("phone").value = userData.phone || ""; // Populate Phone
  }

  document.getElementById("profileEditor").classList.remove("hidden");

  // Reinitialize autocomplete for the city input in the modal
  setupAutocomplete("city", "citySuggestions");
}

document.getElementById("profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const user = auth.currentUser;
  if (!user) {
    alert("You must be logged in to edit your profile!");
    return;
  }

  const userRef = doc(db, "users", user.uid);
  const userDoc = await getDoc(userRef);

  if (!userDoc.exists()) {
    alert("User document not found!");
    return;
  }

  const userData = userDoc.data();

  // Get form values
  const name = document.getElementById("userName").value.trim();
  const bio = document.getElementById("userBio").value.trim();
  const city = document.getElementById("profileCity").value.trim();
  const instagram = document.getElementById("instagram").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const photo = document.getElementById("profilePhoto").files[0];

  // Object to store updated fields
  const updates = {};

  // Check if name has changed
  if (name && name !== userData.name) {
    updates.name = name;
  }

  // Check if bio has changed
  if (bio !== userData.bio) {
    updates.bio = bio;
  }

  // Check if city has changed
  if (city && city !== userData.city) {
    const allCities = Object.values(cityData).flat();
    const normalizedCity = city.toLowerCase().trim();
    const normalizedAllCities = allCities.map(c => c.toLowerCase().trim());

    // Validate city only if it has been changed
    if (!normalizedAllCities.includes(normalizedCity)) {
      alert("Please select a valid city from the suggestions.");
      return;
    }

    updates.city = city;
  }

  // Check if Instagram has changed
  if (instagram !== userData.instagram) {
    // Remove any "@" symbols from the Instagram handle
    const cleanedInstagram = instagram.replace(/@/g, ""); // Remove all "@" symbols
    updates.instagram = cleanedInstagram;
  }

  // Check if Phone has changed
  if (phone !== userData.phone) {
    updates.phone = phone;
  }

  // Check if a new profile photo has been uploaded
  if (photo) {
    const photoRef = ref(storage, `profilePhotos/${user.uid}`);
    await uploadBytes(photoRef, photo);
    const profilePhotoUrl = await getDownloadURL(photoRef);
    updates.profilePhoto = profilePhotoUrl;
  }

  // If no fields were updated, show a message and return
  if (Object.keys(updates).length === 0) {
    alert("No changes were made to your profile.");
    return;
  }

  // Update Firestore document with the changes
  await updateDoc(userRef, updates);

  alert("Profile updated successfully!");
  closeProfileEditor();
});

function closeProfileEditor() {
  document.getElementById("profileEditor").classList.add("hidden");
}

// Recommendations
document.getElementById("recommendationsBtn").addEventListener("click", async () => {
  const user = auth.currentUser;
  console.log("Current User:", user); // Log the authenticated user

  if (!user) {
    alert("You must be logged in to get recommendations.");
    return;
  }

  const recommendationGrid = document.getElementById("recommendationGrid");
  recommendationGrid.innerHTML = "Loading recommendations...";

  try {
    // 1) Get a fresh ID token from the current user
    const idToken = await auth.currentUser.getIdToken(/* forceRefresh */ true);

    // 2) Make a direct POST request to your onRequest function endpoint
    //    (change the URL to match your function's deploy location)
    const response = await fetch("https://us-central1-life-swap-6065e.cloudfunctions.net/getRecommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    // 3) Parse the JSON response
    const data = await response.json();
    const recommendations = data.recommendations;

    // 4) Display the recommendations
    recommendationGrid.innerHTML = "";
    if (!recommendations || recommendations.length === 0) {
      recommendationGrid.innerHTML = "<p>No recommendations found.</p>";
      return;
    }

    recommendations.forEach((post) => {
      recommendationGrid.innerHTML += `
        <div class="post-card">
          <img src="${post.imageUrls?.[0] || "placeholder.jpg"}" alt="${post.title}" />
          <h3>${post.title}</h3>
          <p>${post.description}</p>
          <p><strong>Location:</strong> ${post.city}</p>
        </div>
      `;
    });
  } catch (error) {
    console.error("Error fetching recommendations:", error);
    recommendationGrid.innerHTML = "<p>Error fetching recommendations. Please try again later.</p>";
  }
});

// Load User Profile
async function viewProfile(userId) {
  const userProfileModal = document.getElementById("userProfileModal");
  const userProfileContent = document.getElementById("userProfileContent");

  // Fetch user details
  const userDoc = await getDoc(doc(db, "users", userId));
  if (!userDoc.exists()) {
    alert("User not found.");
    return;
  }

  const userData = userDoc.data();

  // Fetch ratings for the user
  const ratingsQuery = query(collection(db, "ratings"), where("rateeId", "==", userId));
  const ratingsSnapshot = await getDocs(ratingsQuery);

  const ratings = [];
  for (const ratingDoc of ratingsSnapshot.docs) {
    const ratingData = ratingDoc.data();

    // Fetch the rater's name from the users collection
    const raterDoc = await getDoc(doc(db, "users", ratingData.raterId));
    const raterName = raterDoc.exists() ? raterDoc.data().name : "Unknown User";

    ratings.push({
      raterName, // Add the rater's name
      rating: ratingData.rating,
      feedback: ratingData.feedback || "No feedback",
      timestamp: ratingData.timestamp.toDate().toLocaleString(), // Format timestamp
    });
  }

  // Calculate average rating
  const averageRating =
    ratings.length > 0
      ? (ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length).toFixed(1)
      : "No reviews";

  // Build the profile content
  userProfileContent.innerHTML = `
  <button class="close-modal-btn" onclick="closeProfileModal()">Close</button>
    <div class="profile-header">
      <img src="${userData.profilePhoto || "https://via.placeholder.com/150"}" alt="${userData.name}" class="profile-photo" />
      <h3>${userData.name || "Unknown User"}</h3>
      <p>★ ${averageRating} (${ratings.length} reviews)</p>
    </div>
    <div class="profile-details">
      <p><strong>Bio:</strong> ${userData.bio || "No bio provided."}</p>
      <p><strong>City:</strong> ${userData.city || "No city provided."}</p>
      ${userData.instagram ? `<p><strong>Instagram:</strong> <a href="https://instagram.com/${userData.instagram}" target="_blank">@${userData.instagram}</a></p>` : ""}
      ${userData.phone ? `<p><strong>Phone:</strong> ${userData.phone}</p>` : ""}
    </div>
    <div class="profile-ratings">
      <h4 class="h4-ratingsProfile">Ratings</h4>
      ${
        ratings.length > 0
          ? ratings
              .map(
                (r) => `
              <div class="rating-item">
                <p><img class="verify-badge" src="https://firebasestorage.googleapis.com/v0/b/life-swap-6065e.firebasestorage.app/o/static%2Fverify-badg.png?alt=media&token=561b5a0b-42b5-434b-aed3-79531836ce1b"><strong>${r.raterName}</strong> - ${r.rating}/5</p>
                <p>${r.feedback}</p>
                <small>${r.timestamp}</small>
              </div>
            `
              )
              .join("")
          : "<p>No ratings yet.</p>"
      }
    </div>
  `;

  // Show the profile modal
  userProfileModal.classList.remove("hidden");
}

function closeProfileModal() {
  document.getElementById("userProfileModal").classList.add("hidden");
}

// Close Modal
function closeModal() {
  const modal = document.getElementById("modal");
  modal.classList.add("hidden");
}

async function openOfferSwapModal(targetPostId, targetPostTitle) {
  const modal = document.getElementById("offerSwapModal");
  document.getElementById("targetPostTitle").textContent = targetPostTitle;

  const dropdown = document.getElementById("offeredPost");
  dropdown.innerHTML = "<option value='' disabled selected>Select your post</option>";

  const user = auth.currentUser;
  const userPostsQuery = query(collection(db, "posts"), where("userId", "==", user.uid));

  const userPosts = await getDocs(userPostsQuery);
  userPosts.forEach((postDoc) => {
    const post = postDoc.data();
    dropdown.innerHTML += `<option value="${postDoc.id}">${post.title}</option>`;
  });

  modal.classList.remove("hidden");

  document.getElementById("offerSwapForm").onsubmit = async function (e) {
    e.preventDefault();

    const offeredPostId = dropdown.value;
    const message = document.getElementById("swapMessage").value.trim();

    await addDoc(collection(db, "offers"), {
      fromUserId: user.uid,
      toUserId: (await getDoc(doc(db, "posts", targetPostId))).data().userId,
      offeredPostId,
      targetPostId,
      message,
      status: "pending",
      timestamp: new Date(),
    });

    alert("Swap offer sent!");
    closeOfferSwap();
  };
}

function closeOfferSwap() {
  document.getElementById("offerSwapModal").classList.add("hidden");
  document.getElementById("offerSwapForm").reset();
}

async function loadOffers() {
  const user = auth.currentUser;
  const yourOffersDiv = document.getElementById("yourOffers");
  const offersReceivedDiv = document.getElementById("offersReceived");

  yourOffersDiv.innerHTML = "Loading...";
  offersReceivedDiv.innerHTML = "Loading...";

  const yourOffersQuery = query(collection(db, "offers"), where("fromUserId", "==", user.uid));
  const offersReceivedQuery = query(collection(db, "offers"), where("toUserId", "==", user.uid));

  const yourOffersSnapshot = await getDocs(yourOffersQuery);
  const offersReceivedSnapshot = await getDocs(offersReceivedQuery);

  yourOffersDiv.innerHTML = yourOffersSnapshot.empty ? "No offers yet." : "";
  offersReceivedDiv.innerHTML = offersReceivedSnapshot.empty ? "No received offers yet." : "";

  // Display "Your Offers"
  yourOffersSnapshot.forEach(async (offerDoc) => {
    const offer = offerDoc.data();
    const targetPost = await getDoc(doc(db, "posts", offer.targetPostId));
    const offeredPost = await getDoc(doc(db, "posts", offer.offeredPostId));

    const targetPostTitle = targetPost.exists() ? targetPost.data().title : "Unknown Post";
    const offeredPostTitle = offeredPost.exists() ? offeredPost.data().title : "Unknown Post";

    // Query the deals collection for this offer
    const dealQuery = query(collection(db, "deals"), where("offerId", "==", offerDoc.id));
    const dealSnapshot = await getDocs(dealQuery);

    // Initialize button and status variables
    let actionButton = `<button class="cancel-offer-btn" onclick="cancelOffer('${offerDoc.id}')">Cancel Offer</button>`;
    let dealStatus = "Offer pending.";
    let rateButton = "";

    // Check offer status and update accordingly
    if (offer.status === "declined") {
      dealStatus = "Offer declined.";
      actionButton = `<button class="cancel-offer-btn" onclick="cancelOffer('${offerDoc.id}')">Remove Offer</button>`;
    } else if (!dealSnapshot.empty) {
      const deal = dealSnapshot.docs[0].data();
      const dealId = dealSnapshot.docs[0].id;

      if (deal.status === "closed") {
        dealStatus = "Deal closed. Thank you!";
        actionButton = ""; // No action needed
        rateButton = `<button class="rate-btn" onclick="openRatingModal('${dealId}')">Rate</button>`;
      } else if (deal.status === "active") {
        dealStatus = "Deal accepted. Start chatting!";
        actionButton = `<button class="chat-btn" onclick="openChat('${dealId}')">Open Chat</button>`;
      }
    }

    // Render the offer in the UI
    yourOffersDiv.innerHTML += `
      <div class="offer-item">
        <p><strong>Offered for:</strong> <a href="#" onclick="viewDetails('${offer.targetPostId}', true)">${targetPostTitle}</a></p>
        <p><strong>Your Offered Item:</strong> <a href="#" onclick="viewDetails('${offer.offeredPostId}', true)">${offeredPostTitle}</a></p>
        <p>${dealStatus}</p>
        ${actionButton}
        ${rateButton}
      </div>
    `;
  });

  // Display "Offers You Received"
  offersReceivedSnapshot.forEach(async (offerDoc) => {
    const offer = offerDoc.data();
    const offeredPost = await getDoc(doc(db, "posts", offer.offeredPostId));
    const targetPost = await getDoc(doc(db, "posts", offer.targetPostId));
    const fromUser = await getDoc(doc(db, "users", offer.fromUserId));

    const offeredPostTitle = offeredPost.exists() ? offeredPost.data().title : "Unknown Post";
    const targetPostTitle = targetPost.exists() ? targetPost.data().title : "Unknown Post";
    const fromUserName = fromUser.exists() ? fromUser.data().name : "Unknown User";

    // Query the deals collection for this offer
    const dealQuery = query(collection(db, "deals"), where("offerId", "==", offerDoc.id));
    const dealSnapshot = await getDocs(dealQuery);

    // Initialize button and status variables
    let actionButton = `<button class="accept-btn" onclick="acceptOffer('${offerDoc.id}', this)">Accept</button>`;
    let dealStatus = "Offer pending.";
    let rateButton = "";

    // Check offer status and update accordingly
    if (offer.status === "declined") {
      dealStatus = "You declined this offer.";
      actionButton = ""; // No further actions for the receiver
    } else if (!dealSnapshot.empty) {
      const deal = dealSnapshot.docs[0].data();
      const dealId = dealSnapshot.docs[0].id;

      if (deal.status === "closed") {
        dealStatus = "Deal closed. Thank you!";
        actionButton = ""; // No action needed
        rateButton = `<button class="rate-btn" onclick="openRatingModal('${dealId}')">Rate</button>`;
      } else if (deal.status === "active") {
        dealStatus = "Deal accepted. Start chatting!";
        actionButton = `<button class="chat-btn" onclick="openChat('${dealId}')">Open Chat</button>`;
      }
    }

    // Render the offer in the UI
    offersReceivedDiv.innerHTML += `
      <div class="offer-item">
        <p><strong>Offer from:</strong> 
          <a href="#" onclick="viewProfile('${offer.fromUserId}')">${fromUserName}</a>
        </p>
        <p><strong>Message:</strong> ${offer.message || "No message provided."}</p>
        <p><strong>Item Offered:</strong> <a href="#" onclick="viewDetails('${offer.offeredPostId}', true)">${offeredPostTitle}</a></p>
        <p><strong>For Your Post:</strong> <a href="#" onclick="viewDetails('${offer.targetPostId}', true)">${targetPostTitle}</a></p>
        <p>${dealStatus}</p>
        ${actionButton}
        ${rateButton}
        <button class="decline-btn" onclick="declineOffer('${offerDoc.id}')">Decline</button>
      </div>
    `;
  });
}

async function cancelOffer(offerId) {
  if (confirm("Are you sure you want to cancel this offer?")) {
    try {
      await deleteDoc(doc(db, "offers", offerId));
      alert("Offer canceled successfully.");
      loadOffers(); // Refresh the offers list
    } catch (error) {
      console.error("Error canceling offer:", error);
      alert("Failed to cancel the offer. Please try again.");
    }
  }
}

async function acceptOffer(offerId, buttonElement) {
  const offerDoc = await getDoc(doc(db, "offers", offerId));
  const offer = offerDoc.data();

  if (!offer) {
    alert("Offer not found.");
    return;
  }

  // Check if a deal already exists
  const dealQuery = query(collection(db, "deals"), where("offerId", "==", offerId));
  const dealSnapshot = await getDocs(dealQuery);

  let dealId;

  if (dealSnapshot.empty) {
    // Create a new deal if none exists
    const dealRef = await addDoc(collection(db, "deals"), {
      offerId,
      postId: offer.targetPostId,
      offeredPostId: offer.offeredPostId,
      fromUserId: offer.fromUserId,
      toUserId: offer.toUserId,
      status: "active",
      timestamp: new Date(),
    });
    dealId = dealRef.id;
  } else {
    // Use the existing deal ID
    dealId = dealSnapshot.docs[0].id;
  }

  // Fetch user names from Firestore
  const fromUserDoc = await getDoc(doc(db, "users", offer.fromUserId));
  const toUserDoc = await getDoc(doc(db, "users", offer.toUserId));

  const fromUserName = fromUserDoc.exists() ? fromUserDoc.data().name : "Unknown User";
  const toUserName = toUserDoc.exists() ? toUserDoc.data().name : "Unknown User";

  // Notify users about the deal
  await addNotification(offer.fromUserId, {
    type: "offerAccepted",
    content: `${toUserName} accepted your offer. You can now chat.`,
    link: `/chat/${dealId}`,
  });

  await addNotification(offer.toUserId, {
    type: "offerAccepted",
    content: `You accepted ${fromUserName}'s offer. You can now chat.`,
    link: `/chat/${dealId}`,
  });

  // Update the button to "Open Chat"
  buttonElement.outerHTML = `<button class="chat-btn" onclick="openChat('${dealId}')">Open Chat</button>`;
}

async function openChat(dealId) {
  const chatModal = document.getElementById("chatModal");
  const chatContainer = document.getElementById("chatContainer");
  const closeDealBtn = document.getElementById("closeDealBtn");

  if (!dealId) {
    console.error("Deal ID is required to open the chat.");
    return;
  }

  // Fetch deal details
  const dealRef = doc(db, "deals", dealId);
  const dealSnapshot = await getDoc(dealRef);

  if (!dealSnapshot.exists()) {
    console.error("Deal not found!");
    return;
  }

  const deal = dealSnapshot.data();

  // Fetch participant names
  const participants = {};
  async function fetchUserName(userId) {
    if (!participants[userId]) {
      const userRef = doc(db, "users", userId);
      const userDoc = await getDoc(userRef);
      participants[userId] = userDoc.exists() ? userDoc.data().name : "Unknown User";
    }
    return participants[userId];
  }

  // Real-time message listener
  const messagesQuery = query(collection(db, "chats", dealId, "messages"), orderBy("timestamp"));
  onSnapshot(messagesQuery, async (snapshot) => {
    chatContainer.innerHTML = ""; // Clear existing messages
    for (const doc of snapshot.docs) {
      const msg = doc.data();
      const senderName = await fetchUserName(msg.senderId);
      const formattedTimestamp = msg.timestamp
        ? new Date(msg.timestamp.toDate()).toLocaleString()
        : "Unknown Time";
      chatContainer.innerHTML += `
        <p>
          <strong>${senderName}:</strong> ${msg.message}
          <br><small>${formattedTimestamp}</small>
        </p>`;
    }
  });

  // Show "Close Deal" button if the deal is active
  if (deal.status === "active") {
    closeDealBtn.classList.remove("hidden");
    closeDealBtn.onclick = () => closeDeal(dealId);
  } else {
    closeDealBtn.classList.add("hidden");
  }

  chatModal.classList.remove("hidden");

  // Handle new messages
  document.getElementById("chatForm").onsubmit = async (e) => {
    e.preventDefault();
  
    const message = document.getElementById("chatMessage").value.trim();
    if (!message) return;
  
    // Add message to Firestore
    await addDoc(collection(db, "chats", dealId, "messages"), {
      senderId: auth.currentUser.uid,
      message,
      timestamp: new Date(),
    });
  
    // Clear input field
    document.getElementById("chatMessage").value = "";
  
    // Fetch deal details to determine participants
    const dealRef = doc(db, "deals", dealId);
    const dealSnapshot = await getDoc(dealRef);
  
    if (!dealSnapshot.exists()) {
      console.error("Deal not found:", dealId);
      return;
    }
  
    const deal = dealSnapshot.data();
    const currentUserId = auth.currentUser.uid;
    const otherUserId = deal.fromUserId === currentUserId ? deal.toUserId : deal.fromUserId;
  
    // Fetch sender name
    const senderDoc = await getDoc(doc(db, "users", currentUserId));
    const senderName = senderDoc.exists() ? senderDoc.data().name : "Unknown User";
  
    // Add notification for the other user
    try {
      await addNotification(otherUserId, {
        type: "newMessage",
        content: `${senderName} sent you a message: "${message.substring(0, 30)}..."`,
        link: `/chat/${dealId}`,
      });
      console.log("Notification successfully added for user:", otherUserId);
    } catch (error) {
      console.error("Error adding notification:", error);
    }
  };
}

function closeChat() {
  document.getElementById("chatModal").classList.add("hidden");
}

async function closeDeal(dealId) {
  const dealRef = doc(db, "deals", dealId);
  const dealSnapshot = await getDoc(dealRef);

  if (!dealSnapshot.exists()) {
    alert("Deal not found!");
    return;
  }

  const deal = dealSnapshot.data();
  const closedBy = deal.closedBy || [];

  // Check if the current user has already closed the deal
  if (!closedBy.includes(auth.currentUser.uid)) {
    closedBy.push(auth.currentUser.uid);

    await updateDoc(dealRef, { closedBy });

    if (closedBy.length === 2) {
      // Both parties closed the deal
      await updateDoc(dealRef, { status: "closed" });
      alert("Deal closed! Time to leave feedback.");
      openRatingModal(dealId); // Trigger the rating modal
    } else {
      alert("Waiting for the other party to confirm.");
    }
  } else {
    alert("You have already confirmed this deal.");
  }
}

async function addNotification(userId, notification) {
  try {
    await addDoc(collection(db, "notifications", userId, "alerts"), {
      ...notification,
      read: false, // Default to unread
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Error adding notification:", error);
  }
}

// Real-time Notification Listener
function setupNotificationListener() {
  const notificationCountEl = document.getElementById("notificationCount");

  const notificationsQuery = query(
    collection(db, "notifications", auth.currentUser.uid, "alerts"),
    where("read", "==", false)
  );

  onSnapshot(notificationsQuery, (snapshot) => {
    const unreadCount = snapshot.size;

    // Update notification count
    if (unreadCount > 0) {
      notificationCountEl.textContent = unreadCount;
      notificationCountEl.classList.remove("hidden");
    } else {
      notificationCountEl.classList.add("hidden");
    }
  });
}

async function clearAllNotifications() {
  try {
    const user = auth.currentUser;
    if (!user) {
      alert("You need to be logged in to clear notifications.");
      return;
    }

    const notificationsQuery = query(
      collection(db, "notifications", user.uid, "alerts")
    );

    const snapshot = await getDocs(notificationsQuery);

    if (snapshot.empty) {
      alert("No notifications to clear.");
      return;
    }

    const batch = writeBatch(db);
    snapshot.forEach((doc) => {
      batch.delete(doc.ref); // Delete each notification
    });

    await batch.commit();
    alert("All notifications cleared!");

    // Clear the UI
    document.getElementById("notificationList").innerHTML = `
      <p>No notifications.</p>
      <button id="clearNotificationsBtn" onclick="clearAllNotifications()">Clear All</button>
    `;
    document.getElementById("notificationCount").classList.add("hidden");
  } catch (error) {
    console.error("Error clearing notifications:", error);
    alert("Failed to clear notifications. Please try again.");
  }
}

async function sendMessage(dealId, message) {
  if (!message) return;

  const dealRef = doc(db, "deals", dealId);
  const dealSnapshot = await getDoc(dealRef);

  if (!dealSnapshot.exists()) {
    console.error("Deal not found:", dealId);
    return;
  }

  const deal = dealSnapshot.data();
  const currentUserId = auth.currentUser.uid;
  const otherUserId = deal.fromUserId === currentUserId ? deal.toUserId : deal.fromUserId;

  // Add the message to Firestore
  await addDoc(collection(db, "chats", dealId, "messages"), {
    senderId: currentUserId,
    message,
    timestamp: new Date(),
  });

  // Fetch the sender's name
  const senderDoc = await getDoc(doc(db, "users", currentUserId));
  const senderName = senderDoc.exists() ? senderDoc.data().name : "Unknown User";

  console.log("Sending notification to:", otherUserId);

  // Add notification for the other user
  try {
    await addNotification(otherUserId, {
      type: "newMessage",
      content: `${senderName} sent you a message: "${message.substring(0, 30)}..."`,
      link: `/chat/${dealId}`,
    });
    console.log("Notification successfully added.");
  } catch (error) {
    console.error("Failed to add notification:", error);
  }
}

// View Notifications and Mark as Read
async function viewNotifications() {
  const notificationList = document.getElementById("notificationList");

  if (notificationList.classList.contains("hidden")) {
    // Fetch notifications from Firestore
    const notificationsQuery = query(
      collection(db, "notifications", auth.currentUser.uid, "alerts"),
      orderBy("timestamp", "desc")
    );

    const snapshot = await getDocs(notificationsQuery);

    // Add the "Clear All" button at the top
    let htmlContent = `
      <button id="clearNotificationsBtn" onclick="clearAllNotifications()">Clear All</button>
    `;

    // Populate notifications
    if (snapshot.empty) {
      htmlContent += "<p>No notifications.</p>";
    } else {
      snapshot.forEach((doc) => {
        const notification = doc.data();
        const isUnread = !notification.read; // Check if the notification is unread

        htmlContent += `
          <p 
            class="${isUnread ? 'unread-notification' : ''}" 
            onclick="handleNotificationClick('${notification.link}', '${doc.id}')">
            ${notification.content || "You have a new notification"}
          </p>
        `;
      });
    }

    // Set the content of the notification list and show it
    notificationList.innerHTML = htmlContent;
    notificationList.classList.remove("hidden");
  } else {
    notificationList.classList.add("hidden"); // Hide the notification list
  }
}

// Handle Notification Click (Open Modal or Redirect)
async function handleNotificationClick(link, notificationId) {
  const notifRef = doc(db, "notifications", auth.currentUser.uid, "alerts", notificationId);
  await updateDoc(notifRef, { read: true }); // Mark as read

  // Redirect or handle the link
  if (link.startsWith("/chat/")) {
    const dealId = link.split("/chat/")[1];
    openChat(dealId); // Open chat modal
  } else {
    window.location.href = link; // Redirect to the provided link
  }

  // Optionally refresh notifications to update their status
  viewNotifications();
}

async function markAsRead(notificationId) {
  const notifRef = doc(db, "notifications", auth.currentUser.uid, "alerts", notificationId);
  await updateDoc(notifRef, { read: true });
}

function closeRating() {
  document.getElementById("ratingModal").classList.add("hidden");
}

async function openRatingModal(dealId) {
  const ratingModal = document.getElementById("ratingModal");
  ratingModal.classList.remove("hidden");
  ratingModal.dataset.dealId = dealId;

  // Check if the user has already rated
  const ratingsQuery = query(
    collection(db, "ratings"),
    where("dealId", "==", dealId),
    where("raterId", "==", auth.currentUser.uid)
  );
  const ratingsSnapshot = await getDocs(ratingsQuery);
  if (!ratingsSnapshot.empty) {
    alert("You have already rated this deal.");
    closeRatingModal();
    return;
  }

  document.getElementById("rating").value = "";
  document.getElementById("feedback").value = "";
}

function closeRatingModal() {
  document.getElementById("ratingModal").classList.add("hidden");
}

async function submitRating() {
  const dealId = document.getElementById("ratingModal").dataset.dealId;
  const rating = parseInt(document.getElementById("rating").value);
  const feedback = document.getElementById("feedback").value.trim();

  if (isNaN(rating) || rating < 0 || rating > 5) {
    alert("Please provide a valid rating between 0 and 5.");
    return;
  }

  const dealSnapshot = await getDoc(doc(db, "deals", dealId));
  if (!dealSnapshot.exists()) {
    alert("Deal not found.");
    return;
  }

  const deal = dealSnapshot.data();
  const rateeId = deal.toUserId === auth.currentUser.uid ? deal.fromUserId : deal.toUserId;

  const existingRatingQuery = query(
    collection(db, "ratings"),
    where("dealId", "==", dealId),
    where("raterId", "==", auth.currentUser.uid)
  );
  const existingRatingSnapshot = await getDocs(existingRatingQuery);

  if (!existingRatingSnapshot.empty) {
    const ratingRef = existingRatingSnapshot.docs[0].ref;
    await updateDoc(ratingRef, { rating, feedback });
  } else {
    await addDoc(collection(db, "ratings"), {
      dealId,
      raterId: auth.currentUser.uid,
      rateeId,
      rating,
      feedback,
      timestamp: new Date(),
    });
  }

  alert("Rating submitted!");
  closeRatingModal();
}

async function declineOffer(offerId) {
  try {
    // Fetch the offer document
    const offerDoc = await getDoc(doc(db, "offers", offerId));
    if (!offerDoc.exists()) {
      alert("Offer not found. It may have already been removed.");
      return;
    }

    const offer = offerDoc.data();
    const fromUserId = offer.fromUserId;

    // Fetch the sender's name
    const fromUserDoc = await getDoc(doc(db, "users", fromUserId));
    const fromUserName = fromUserDoc.exists() ? fromUserDoc.data().name : "Unknown User";

    // Fetch the current user's name from Firestore
    const currentUserRef = doc(db, "users", auth.currentUser.uid);
    const currentUserDoc = await getDoc(currentUserRef);
    const currentUserName = currentUserDoc.exists() ? currentUserDoc.data().name : "Unknown User";

    // Fetch the target post title
    const targetPostDoc = await getDoc(doc(db, "posts", offer.targetPostId));
    const targetPostTitle = targetPostDoc.exists() ? targetPostDoc.data().title : "Unknown Post";

    // Delete the offer document
    await deleteDoc(doc(db, "offers", offerId));

    // Notify the sender about the declined offer
    await addNotification(fromUserId, {
      type: "offerDeclined",
      content: `${currentUserName} declined your offer for "${targetPostTitle}".`,
      link: `#`, // Link to the sender's offers page (You can add a different one later a page explaining why you got declined)
    });

    alert(`You declined an offer from ${fromUserName}.`);
    loadOffers(); // Refresh the offers list
  } catch (error) {
    console.error("Error declining offer:", error);
    alert("Failed to decline the offer. Please try again.");
  }
}

// Toggle "Your Posts" section
function toggleYourPosts() {
  const yourPostsContainer = document.getElementById("yourPostsContainer");
  const toggleBtn = document.getElementById("toggleYourPostsBtn");

  // Check if the section is currently hidden
  if (yourPostsContainer.classList.contains("hidden")) {
    yourPostsContainer.classList.remove("hidden");
    toggleBtn.textContent = "Hide Your Posts";
    loadYourPosts(); // Load posts when showing the section
  } else {
    yourPostsContainer.classList.add("hidden");
    toggleBtn.textContent = "See Your Posts";
  }
}

// Load "Your Posts" functionality
async function loadYourPosts() {
  const user = auth.currentUser;
  const yourPostsDiv = document.getElementById("yourPosts");
  yourPostsDiv.innerHTML = "Loading...";

  if (!user) {
    yourPostsDiv.innerHTML = "<p>You need to log in to see your posts.</p>";
    return;
  }

  // Fetch user's posts
  const yourPostsQuery = query(collection(db, "posts"), where("userId", "==", user.uid));
  const yourPostsSnapshot = await getDocs(yourPostsQuery);

  if (yourPostsSnapshot.empty) {
    yourPostsDiv.innerHTML = "<p>You have not created any posts yet.</p>";
    return;
  }

  yourPostsDiv.innerHTML = ""; // Clear loading message

  // Display each post
  yourPostsSnapshot.forEach((postDoc) => {
    const post = postDoc.data();
    const postId = postDoc.id;

    const postElement = document.createElement("div");
    postElement.className = "your-post-item";
    postElement.innerHTML = `
      <p class="post-title">${post.title}</p>
      <button class="view-post-btn" onclick="viewDetails('${postId}', true)">View</button>
      <button class="delete-post-btn" onclick="deletePost('${postId}')">Delete</button>
    `;

    yourPostsDiv.appendChild(postElement);
  });
}

// Delete a post
async function deletePost(postId) {
  if (confirm("Are you sure you want to delete this post? This action cannot be undone.")) {
    try {
      await deleteDoc(doc(db, "posts", postId));
      alert("Post deleted successfully.");
      loadYourPosts(); // Refresh "Your Posts" section
    } catch (error) {
      console.error("Error deleting post:", error);
      alert("Failed to delete the post. Please try again.");
    }
  }
}

// Load "Your Posts" on page load
document.addEventListener("DOMContentLoaded", async () => {
  await loadYourPosts();
});

// Attach global functions to the window object
window.openProfileEditor = openProfileEditor;
window.closeProfileEditor = closeProfileEditor;
window.logout = logout;
window.viewDetails = viewDetails;
window.closeModal = closeModal;
window.viewProfile = viewProfile;
window.closeProfileModal = closeProfileModal;
window.applyFilters = applyFilters;
window.suggestHashtags = suggestHashtags;
window.debouncedSuggestHashtags = debouncedSuggestHashtags;
window.openOfferSwapModal = openOfferSwapModal;
window.closeOfferSwap = closeOfferSwap;
window.loadOffers = loadOffers;
window.acceptOffer = acceptOffer;
window.declineOffer = declineOffer;
window.deletePost = deletePost;
window.toggleYourPosts = toggleYourPosts;
window.closeChat = closeChat;
window.closeDeal = closeDeal;
window.submitRating = submitRating;
window.viewNotifications = viewNotifications;
window.markAsRead = markAsRead;
window.setupNotificationListener = setupNotificationListener;
window.handleNotificationClick = handleNotificationClick;
window.addNotification = addNotification;
window.closeRating = closeRating;
window.openChat = openChat;
window.sendMessage = sendMessage;
window.cancelOffer = cancelOffer;
window.openRatingModal = openRatingModal;
window.setupAutocomplete = setupAutocomplete;
window.clearAllNotifications = clearAllNotifications;