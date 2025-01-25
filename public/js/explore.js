// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, 
  initializeFirestore, 
  CACHE_SIZE_UNLIMITED, 
  collection, addDoc, 
  writeBatch, limit, 
  startAfter, setDoc, 
  getDocs, where, orderBy, 
  onSnapshot, updateDoc, query, 
  doc, getDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
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
const db = initializeFirestore(app, {
  cacheSizeBytes: CACHE_SIZE_UNLIMITED, // Optional: Adjust cache size as needed
  experimentalForceLongPolling: true,   // Optional: Improve reliability in certain network conditions
  persistence: true                     // Enable offline persistence
});
const storage = getStorage(app);
const auth = getAuth(app);
const MIN_ZOOM_LEVEL = 16; // Minimum zoom level to load posts

// Authentication Check
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("You must be logged in to use Life Swap!");
    window.location.href = "/login.html"; // Redirect to login page
  } else {
    const userRef = doc(db, "users", user.uid);
    const userDoc = await getDoc(userRef);

    if (!userDoc.exists()) {
      // New user: Create a default document with their email
      await setDoc(userRef, {
        name: user.displayName || "New User", // Default to Firebase display name or "New User"
        email: user.email || "",             // Save email if available
        bio: "",
        city: "",                            // Empty city
        profilePhoto: null,                  // No profile photo
        joinedAt: new Date(),                // Track when the user joined
      });
      console.log("User document created for new user.");
    } else {
      // If the document exists, check if the email field is missing and add it
      const userData = userDoc.data();
      if (!userData.email && user.email) {
        await updateDoc(userRef, { email: user.email });
        console.log("Email added to existing user document.");
      } else {
        console.log("User document already exists and email is up-to-date.");
      }
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

// Initialize the map
const map = L.map("map").setView([40.7128, -74.0060], 10); // Default center is New York City

// Add OpenStreetMap tiles
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap",
}).addTo(map);

const postMarkersGroup = L.layerGroup().addTo(map);

// Add zoom alert control to the map
const zoomAlertControl = L.control({ position: 'bottomleft' });
zoomAlertControl.onAdd = function(map) {
  this._div = L.DomUtil.create('div', 'zoom-alert');
  this._div.id = 'mapZoomAlert';
  this._div.innerHTML = '🔍 Zoom in to see posts';
  return this._div;
};
zoomAlertControl.addTo(map);

// Add the recenter button and enable geolocation
centerMapOnUserLocation(map);

// Add the moveend event listener AFTER the map is initialized
map.on("moveend", async () => {
    // If the flag is set, skip fetching on this event and reset the flag
    if (suppressFetchOnce) {
      suppressFetchOnce = false;
      return;  // Skip this execution
    }

  // Set a new timeout
  clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(async () => {
    const zoomAlert = document.getElementById('mapZoomAlert');
    const currentZoom = map.getZoom();
    const postGrid = document.getElementById("postGrid");

    if (currentZoom < MIN_ZOOM_LEVEL) {
      postMarkersGroup.clearLayers();
      postGrid.innerHTML = "";
      zoomAlert.style.display = 'block'; // Show map alert
      return;
    } else {
      zoomAlert.style.display = 'none'; // Hide alert when zoomed in
    }

    const bounds = map.getBounds();
    const southwest = bounds.getSouthWest();
    const northeast = bounds.getNorthEast();

    // Proceed to load posts and map pins only if zoom is sufficient
    await loadPosts(
      appliedFilters.filterType,
      appliedFilters.filterHashtags,
      1,
      appliedFilters.filterCategory,
      { southwest, northeast }
    );

    await loadPostsToMap(
      map,
      appliedFilters.filterType,
      appliedFilters.filterHashtags,
      appliedFilters.filterCategory,
      { southwest, northeast }
    );
  }, 300); // Debounce 300ms
});

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
  // 1. The image compression function
  async function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          // Create an off-screen canvas
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Scale down to maintain aspect ratio if bigger than max dimensions
          if (width > height) {
            if (width > maxWidth) {
              height = Math.floor(height * (maxWidth / width));
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.floor(width * (maxHeight / height));
              height = maxHeight;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Convert canvas back to Blob (this is where compression happens)
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('Canvas is empty or could not be converted to blob.'));
                return;
              }
              // Keep the original file name if desired
              blob.name = file.name;
              resolve(blob);
            },
            'image/jpeg', // or 'image/png'
            quality       // 0.0 ~ 1.0 (JPEG quality)
          );
        };
        img.onerror = reject;
        img.src = e.target.result; // base64 data URL
      };
      reader.onerror = reject;
      reader.readAsDataURL(file); // read the file in base64
    });
  }

  // 2. The postForm submission handler
  document.getElementById("postForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    // (Assuming `auth`, `db`, `storage`, `loadPosts()` etc. are all already set up)

    const hashtagsField = document.getElementById("hashtags");
    // Clean the hashtags input to remove any trailing comma
    hashtagsField.value = hashtagsField.value.replace(/,\s*$/, "");

    const title = document.getElementById("title").value.trim();
    const description = document.getElementById("description").value.trim();
    const postType = document.getElementById("postType").value;
    const category = document.getElementById("category").value;
    const city = document.getElementById("city").value.trim();
    const distance = parseInt(document.getElementById("distance").value) || 0;

    // New fields: Latitude and Longitude
    const latitude = parseFloat(document.getElementById("latitude").value);
    const longitude = parseFloat(document.getElementById("longitude").value);

    if (isNaN(latitude) || isNaN(longitude)) {
      alert("Please click on 'Add My Location' to set your current location.");
      return;
    }

    // New field: Desired trade
    const desiredTrade = document.getElementById("desiredTrade").value.trim();

    // Clean and prepare hashtags
    const hashtags = hashtagsField.value
      .split(",")
      .map((tag) => `#${tag.trim().toLowerCase().replace(/^#/, "")}`)
      .filter((tag) => tag); // Remove empty tags

    // Gather images from file input
    const images = document.getElementById("images").files;

    const user = auth.currentUser;
    if (!user) {
      alert("You must be logged in to post!");
      return;
    }

    // 3. Compress & upload images
    const imageUrls = [];
    for (const image of images) {
      // Compress the image before upload
      const compressedImage = await compressImage(image, 800, 800, 0.7);

      // Now upload the compressed blob instead of the raw file
      const imageRef = ref(storage, `images/${user.uid}/${compressedImage.name}`);
      await uploadBytes(imageRef, compressedImage);

      // Get the download URL for that image
      const url = await getDownloadURL(imageRef);
      imageUrls.push(url);
    }

    // 4. Add doc to Firestore
    await addDoc(collection(db, "posts"), {
      title,
      description,
      desiredTrade,
      type: postType,
      category,
      city: city.trim(),
      distanceFromCity: distance,
      latitude,
      longitude,
      hashtags,
      imageUrls,
      userId: user.uid,
      timestamp: new Date(),
    });

    alert("Post created successfully!");
    document.getElementById("postForm").reset();

    // Reload or refresh your posts if needed
    loadPosts();
  });

// Load Posts
let postsPerPage = 6; // Default number of posts per page
let currentPage = 1; // Current page
let lastVisibleDocs = []; // Track last visible documents for pagination
let appliedFilters = {}; // Store applied filters globally
let totalPosts = 0; // Initialize with a default value
let debounceTimeout;

// Function to load posts within the current map bounds
async function loadPosts(
  filterType = "",
  filterHashtags = [],
  page = 1,
  filterCategory = "",
  mapBounds // mapBounds is required
) {
  if (!mapBounds) {
    console.warn("mapBounds is required to load posts. Skipping...");
    return;
  }

  const { southwest, northeast } = mapBounds; // Destructure mapBounds

  const postGrid = document.getElementById("postGrid");
  const postsPerPageSelector = document.getElementById("postsPerPageSelector");
  postGrid.innerHTML = "Loading...";

  // Set postsPerPage based on user selection
  const postsPerPage = parseInt(postsPerPageSelector.value) || 6;

  const user = auth.currentUser;
  if (!user) {
    console.log("You must be logged in to view posts!");
    return;
  }

  const userRef = doc(db, "users", user.uid);
  const userDoc = await getDoc(userRef);

  if (!userDoc.exists()) {
    console.log("User document not found!");
    return;
  }

  // Reset pagination for a new query
  if (page === 1) {
    lastVisibleDocs = [];
    currentPage = 1;
  }

  // Construct the query
  let postsQuery = collection(db, "posts");
  const conditions = [];

  // Add conditions dynamically based on filters
  if (filterType) conditions.push(where("type", "==", filterType));
  if (filterCategory) conditions.push(where("category", "==", filterCategory));
  if (filterHashtags.length > 0) conditions.push(where("hashtags", "array-contains-any", filterHashtags));

  // Add map bounds condition
  conditions.push(where("latitude", ">=", southwest.lat));
  conditions.push(where("latitude", "<=", northeast.lat));
  conditions.push(where("longitude", ">=", southwest.lng));
  conditions.push(where("longitude", "<=", northeast.lng));

  conditions.push(orderBy("timestamp", "desc"));
  conditions.push(limit(postsPerPage));

  // Handle pagination
  if (page > 1 && lastVisibleDocs[page - 2]) {
    conditions.push(startAfter(lastVisibleDocs[page - 2]));
  }

  postsQuery = query(postsQuery, ...conditions);

  try {
    const querySnapshot = await getDocs(postsQuery);

    if (querySnapshot.empty) {
      postGrid.innerHTML = page === 1 ? "<p class='zoom-warning'>No posts available.</p>" : "";
      return;
    }

    lastVisibleDocs[page - 1] = querySnapshot.docs[querySnapshot.docs.length - 1];
    currentPage = page;

    // Render posts
    postGrid.innerHTML = "";
    querySnapshot.docs.forEach((doc) => {
      const post = doc.data();
      const imageUrl = post.imageUrls?.[0] || "https://via.placeholder.com/150";
      const postDate = post.timestamp ? new Date(post.timestamp.toDate()).toLocaleString() : "Unknown date";
      const hashtags = post.hashtags
        ? post.hashtags
            .map(
              (tag) => `
                <span 
                  class="clickable-hashtag" 
                  onclick="filterByHashtag('${tag}')"
                  style="cursor: pointer; color: blue; text-decoration: underline;">
                  ${tag}
                </span>`
            )
            .join(", ")
        : "No hashtags";

      const postCard = document.createElement("div");
      postCard.classList.add("post-card");
      postCard.innerHTML = `
        <div class="post-header">
          <img src="${imageUrl}" alt="${post.title}" class="post-image" />
          <div class="post-info">
            <h3 class="post-title">${post.title}</h3>
            <p class="post-desired-trade"><strong>📌 Desired Trade:</strong> ${post.desiredTrade || "Not specified"}</p>
            <p class="post-location">${post.city ? `🌍 ${post.city} (${post.distanceFromCity || 0} miles away)` : `📍 Coordinates: ${post.latitude?.toFixed(4)}, ${post.longitude?.toFixed(4)}`}</p>
            <p class="post-date">Posted on: ${postDate}</p>
            <p class="post-hashtags"><strong>Hashtags:</strong> ${hashtags}</p>
          </div>
        </div>
        <button onclick="viewDetails('${doc.id}')">View Details</button>
      `;
      postGrid.appendChild(postCard);
    });

    if (page === 1) {
      fetchTotalPosts(mapBounds); // Pass mapBounds to fetchTotalPosts
    }
    renderPaginationControls();
  } catch (error) {
    console.error("Error loading posts:", error);
    postGrid.innerHTML = "<p>Error loading posts. Please try again later.</p>";
  }
}

// Fetch total posts count for pagination controls
async function fetchTotalPosts(mapBounds) {
  if (!mapBounds) {
    console.error("mapBounds is required to fetch total posts.");
    return;
  }

  const { southwest, northeast } = mapBounds;

  // Fetch posts within the visible map bounds
  const totalQuery = query(
    collection(db, "posts"),
    where("latitude", ">=", southwest.lat),
    where("latitude", "<=", northeast.lat),
    where("longitude", ">=", southwest.lng),
    where("longitude", "<=", northeast.lng)
  );

  const totalSnapshot = await getDocs(totalQuery);
  totalPosts = totalSnapshot.size;
  console.log("Total posts within bounds:", totalPosts);
}

// Render pagination controls
function renderPaginationControls() {
  // Calculate total pages, ensuring at least one page is shown
  const totalPages = Math.max(Math.ceil(totalPosts / postsPerPage), 1);

  // Get pagination container
  const pagination = document.getElementById("pagination");
  pagination.innerHTML = ""; // Clear existing buttons

  // Helper function to create a button
  const createButton = (text, page, disabled = false) => {
    const button = document.createElement("button");
    button.textContent = text;
    button.disabled = disabled;
    button.onclick = () => {
      if (!disabled) {
        loadPosts(
          appliedFilters.filterType,
          appliedFilters.filterHashtags,
          appliedFilters.filterCity,
          appliedFilters.filterDistance,
          page
        );
      }
    };
    return button;
  };

  // Add Previous button
  pagination.appendChild(createButton("<", currentPage - 1, currentPage === 1));

  // Add numbered page buttons
  for (let i = 1; i <= totalPages; i++) {
    const button = createButton(i, i, i === currentPage);
    if (i === currentPage) {
      button.classList.add("active"); // Highlight the current page
    }
    pagination.appendChild(button);
  }

  // Add Next button
  pagination.appendChild(createButton(">", currentPage + 1, currentPage >= totalPages));
}

// Event listener for changing posts per page
document.getElementById("postsPerPageSelector").addEventListener("change", () => {
  currentPage = 1; // Reset to first page
  lastVisibleDocs = []; // Clear pagination state
  loadPosts();
});

// Load posts on page load
document.addEventListener("DOMContentLoaded", () => {
  loadPosts();
});

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

function filterByHashtag(hashtag) {
  console.log(`Filtering posts by hashtag: ${hashtag}`);
  
  // Pass the clicked hashtag as the filter
  applyFilters("", [hashtag], "", 0); // Set filterType, hashtags array, city, and distance
}

function applyFilters(
  filterType = document.getElementById("filterType").value,
  filterHashtags = document.getElementById("filterHashtag").value.split(',').map(t => t.trim()).filter(t => t),
  filterCity = document.getElementById("filterCity").value.trim(),
  filterDistance = parseInt(document.getElementById("filterDistance").value) || 0,
  filterCategory = document.getElementById("filterCategory").value
) {
  if (!map) {
    console.error("Map is not initialized.");
    return;
  }

  // Check the current zoom level
  const currentZoom = map.getZoom();
  if (currentZoom < MIN_ZOOM_LEVEL) {
    const zoomMessage = `🔍 Please zoom in to view posts in this area`;
    
    // Show alert and update grid message
    alert(zoomMessage);
    postGrid.innerHTML = `<p class="zoom-warning">${zoomMessage}</p>`;
    
    // Optional: Briefly shake the map container
    const mapContainer = document.getElementById("map");
    mapContainer.classList.add('shake-animation');
    setTimeout(() => mapContainer.classList.remove('shake-animation'), 500);
    
    return;
  }

  // Always get fresh bounds
  const bounds = map.getBounds();
  const southwest = bounds.getSouthWest();
  const northeast = bounds.getNorthEast();

  // Update global filters
  appliedFilters = {
    filterType: filterType,
    filterHashtags: filterHashtags,
    filterCity: filterCity,
    filterDistance: filterDistance,
    filterCategory: filterCategory
  };

  // Update UI filters display
  displayAppliedFilters(appliedFilters);

  // Load posts with current filters
  loadPosts(
    appliedFilters.filterType,
    appliedFilters.filterHashtags,
    1,
    appliedFilters.filterCategory,
    { southwest, northeast }
  );

  // Update map markers
  loadPostsToMap(
    map,
    appliedFilters.filterType,
    appliedFilters.filterHashtags,
    appliedFilters.filterCategory,
    { southwest, northeast }
  );
}

function displayAppliedFilters(filters) {
  const appliedFiltersDiv = document.getElementById("appliedFilters");
  appliedFiltersDiv.innerHTML = "";

  // Create filter bubbles with closure-protected filters
  const createBubble = (label, clearField) => {
    const bubble = document.createElement("div");
    bubble.className = "filter-bubble";
    bubble.innerHTML = `
      <span>${label}</span>
      <button class="remove-btn">×</button>
    `;
    bubble.querySelector(".remove-btn").addEventListener("click", () => {
      clearField();
      applyFilters(); // Re-apply filters with updated values
    });
    appliedFiltersDiv.appendChild(bubble);
  };

  if (filters.filterType) {
    createBubble(`Type: ${filters.filterType}`, () => {
      document.getElementById("filterType").value = "";
    });
  }

  if (filters.filterCategory) {
    createBubble(`Category: ${filters.filterCategory}`, () => {
      document.getElementById("filterCategory").value = "";
    });
  }

  if (filters.filterCity) {
    createBubble(`City: ${filters.filterCity}`, () => {
      document.getElementById("filterCity").value = "";
    });
  }

  if (filters.filterDistance) {
    createBubble(`Distance: ${filters.filterDistance} miles`, () => {
      document.getElementById("filterDistance").value = "";
    });
  }

  filters.filterHashtags.forEach(hashtag => {
    createBubble(`Hashtag: ${hashtag}`, () => {
      const hashtagsInput = document.getElementById("filterHashtag");
      const newValue = hashtagsInput.value
        .split(',')
        .map(t => t.trim())
        .filter(t => t.toLowerCase() !== hashtag.toLowerCase())
        .join(', ');
      hashtagsInput.value = newValue;
    });
  });

  if (appliedFiltersDiv.children.length > 0) {
    const clearButton = document.createElement("button");
    clearButton.textContent = "Clear All Filters";
    clearButton.className = "clear-filters-btn";
    clearButton.addEventListener("click", () => {
      document.querySelectorAll('.filter-input').forEach(input => {
        if (input.type === 'text') input.value = '';
        if (input.type === 'select-one') input.selectedIndex = 0;
        if (input.type === 'number') input.value = '';
      });
      applyFilters();
    });
    appliedFiltersDiv.appendChild(clearButton);
  }
}

function createFilterBubble(container, text, onRemove) {
  const bubble = document.createElement("div");
  bubble.className = "filter-bubble";
  bubble.innerHTML = `<span>${text}</span> <button class="remove-btn">×</button>`;
  bubble.querySelector(".remove-btn").onclick = onRemove;
  container.appendChild(bubble);
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

// Separate debounceTimeout variables for each function
let debounceTimeoutSuggestHashtags;

// Debounced function for suggesting hashtags
function debouncedSuggestHashtags(inputValue) {
  clearTimeout(debounceTimeoutSuggestHashtags); // Clear the timeout for this function
  debounceTimeoutSuggestHashtags = setTimeout(() => suggestHashtags(inputValue), 300); // 300ms delay
}

/****************************/
/* 1. Helper Functions      */
/****************************/

// A) Reverse Geocoding: Convert lat/lng -> city name
// Global variables for caching and rate-limiting
const nominatimCache = new Map();  // Cache lat/lon => city
let lastNominatimRequestTime = 0;  // Timestamp of last request

/**
 * Ensures at least 1 second (1000ms) passes between calls to Nominatim.
 */
function enforceRateLimit() {
  const now = Date.now();
  const timeSinceLast = now - lastNominatimRequestTime;
  const minInterval = 1100; // ~1.1 seconds to be safe

  if (timeSinceLast < minInterval) {
    // We need to wait the remaining time
    return new Promise((resolve) => {
      setTimeout(() => {
        lastNominatimRequestTime = Date.now();
        resolve();
      }, minInterval - timeSinceLast);
    });
  } else {
    // We can proceed now
    lastNominatimRequestTime = now;
    return Promise.resolve();
  }
}

/**
 * Reverse geocoding with caching, rate limiting, and lat/lng fallback.
 * @param {number} lat 
 * @param {number} lon 
 * @returns {string} City/Town/Village name or "lat, lon" if not found.
 */
async function getCityFromCoordinates(lat, lon) {
  // 1. Check our cache first
  const cacheKey = `${lat},${lon}`;
  if (nominatimCache.has(cacheKey)) {
    // Found it in cache
    return nominatimCache.get(cacheKey);
  }

  // 2. Enforce rate-limiting before any new request
  await enforceRateLimit();

  // 3. Try fetching from Nominatim
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
    const response = await fetch(url, {
      headers: {
        // Nominatim usage policy suggests setting a descriptive user-agent
        "User-Agent": "Life Swap/1.0 (aaadjrbr@gmail.com)"
      }
    });

    if (!response.ok) {
      throw new Error("Failed to fetch city from coordinates");
    }

    const data = await response.json();
    const { address } = data;

    // 4. Get the city name from the response
    // If none found, we'll fallback to lat/lon below
    let cityName = 
      address.city || address.town || address.village || "";

    // 5. Fallback to lat/long if cityName is empty
    if (!cityName) {
      cityName = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    }

    // 6. Store in cache
    nominatimCache.set(cacheKey, cityName);

    // 7. Return final city name
    return cityName;
  } catch (err) {
    console.error("Nominatim error:", err);
    // If there's an error, fallback to lat/long
    const fallbackName = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    // Optionally, store in cache to avoid repeated failing calls
    nominatimCache.set(cacheKey, fallbackName);
    return fallbackName;
  }
}

// B) Haversine Formula: Calculate distance in miles between two lat/lng
function calculateDistanceInMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Earth radius in miles
  const toRad = (val) => val * (Math.PI / 180);
  
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const radLat1 = toRad(lat1);
  const radLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) *
      Math.sin(dLon / 2) *
      Math.cos(radLat1) *
      Math.cos(radLat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // distance in miles
}

/****************************/
/* 2. Main View Details     */
/****************************/
async function viewDetails(postId, hideOfferSwap = false) {
  const modal = document.getElementById("modal");
  const modalContent = document.getElementById("modalContent");

  // A) Define friendly category names
  const categoryNames = {
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

  // B) Fetch the post from Firestore
  const postDoc = await getDoc(doc(db, "posts", postId));
  const post = postDoc.data();

  if (!post) {
    alert("Post not found.");
    return;
  }

  // C) Fetch & calculate user rating
  const ratingsQuery = query(
    collection(db, "ratings"),
    where("rateeId", "==", post.userId)
  );
  const ratingsSnapshot = await getDocs(ratingsQuery);

  let totalRating = 0;
  let ratingCount = 0;
  ratingsSnapshot.forEach((ratingDoc) => {
    const ratingData = ratingDoc.data();
    totalRating += ratingData.rating;
    ratingCount += 1;
  });
  const averageRating = ratingCount > 0
    ? (totalRating / ratingCount).toFixed(1)
    : "No reviews";

  // D) Fetch user info
  const userDoc = await getDoc(doc(db, "users", post.userId));
  const user = userDoc.exists()
    ? userDoc.data()
    : { name: "Unknown User", profilePhoto: "default-profile-photo.jpg" };

  // E) Reverse Geocode if city is not in DB
  let cityName = post.city || "";
  if (!cityName && post.latitude && post.longitude) {
    cityName = await getCityFromCoordinates(post.latitude, post.longitude);
  }

  // F) Prepare to store distance from viewer's location to post's location
  //    We'll do a dynamic update if user grants geolocation.
  let distanceAway = ""; // will be updated asynchronously

  // Attempt to get user’s current location, if post has lat/lng
  if (post.latitude && post.longitude && "geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userLat = position.coords.latitude;
        const userLon = position.coords.longitude;

        const miles = calculateDistanceInMiles(
          userLat,
          userLon,
          post.latitude,
          post.longitude
        );
        distanceAway = `${miles.toFixed(1)} miles away`;

        // Update the distance text in the modal (look for our .dynamic-distance span)
        const distSpan = modalContent.querySelector(".post-location .dynamic-distance");
        if (distSpan) {
          distSpan.textContent = distanceAway;
        }
      },
      (error) => {
        console.warn("Geolocation error or user denied:", error);
        distanceAway = "Location access denied";
      }
    );
  }

  // G) Build the modal HTML
  //    We'll use a span for the dynamic distance so we can fill it in later
  let currentIndex = 0;
  const imageCount = post.imageUrls?.length || 0;

  modalContent.innerHTML = `
    <div class="post-details">
      <h3 class="post-title">${post.title}</h3>
      <div class="carousel">
        ${
          imageCount > 1
            ? `<button class="carousel-button" id="prev">←</button>`
            : ""
        }
          <img 
            src="${post.imageUrls?.[0] || 'https://via.placeholder.com/150'}" 
            class="carousel-image" 
            alt="Post Image"
          />
        ${
          imageCount > 1
            ? `<button class="carousel-button" id="next">→</button>`
            : ""
        }
      </div>
      <div class="container-viewdetails-buttons">
        ${
          !hideOfferSwap
            ? `<button 
                 class="offer-swap-btn" 
                 onclick="openOfferSwapModal('${postId}', '${post.title}')">
                 Offer Swap
               </button>`
            : ""
        }
        <button class="close-modal-btn" onclick="closeModal()">Close ❌</button>
      </div>
      
      <p class="post-description">${post.description}</p>
      <p class="post-category">
        <strong>Category:</strong> ${categoryNames[post.category] || post.category}
      </p>
      
      <p class="post-location">
        <strong>Location:</strong>
        ${cityName}
        ${
          // If there's lat/lng, show a placeholder for the dynamic distance
          post.latitude && post.longitude
            ? ` (<span class="dynamic-distance">${distanceAway}</span>)`
            : ""
        }
      </p>

      <p class="post-desired-trade">
        <strong>Desired Trade:</strong> ${post.desiredTrade || "Not specified"}
      </p>

      <div class="user-info">
        <img src="${user.profilePhoto}" 
             alt="${user.name}" 
             class="profile-photo" />
        <p class="post-rating">★ ${averageRating} (${ratingCount} reviews)</p>
        <p class="user-name">
          <strong>Posted by:</strong>
          <span class="clickable-author" onclick="viewProfile('${post.userId}')">
            ${user.name}
          </span>
        </p>
      </div>
    </div>
  `;

  // H) Handle carousel navigation if multiple images
  const carouselImage = modalContent.querySelector(".carousel-image");
  carouselImage.addEventListener("click", () => openImageViewer(post.imageUrls[currentIndex]));
  
  // Update your updateCarousel function:
  function updateCarousel() {
    const carouselImage = modalContent.querySelector(".carousel-image");
    carouselImage.src = post.imageUrls[currentIndex];
    
    // Remove existing click listener and add new one
    carouselImage.replaceWith(carouselImage.cloneNode(true));
    modalContent.querySelector(".carousel-image").addEventListener("click", () => {
      openImageViewer(post.imageUrls[currentIndex]);
    });
  }

  if (imageCount > 1) {
    document.getElementById("prev").addEventListener("click", () => {
      currentIndex = (currentIndex - 1 + imageCount) % imageCount;
      updateCarousel();
    });
    document.getElementById("next").addEventListener("click", () => {
      currentIndex = (currentIndex + 1) % imageCount;
      updateCarousel();
    });
  }

  // I) Finally, show the modal
  modal.classList.remove("hidden");
}

const openImageViewer = (imageUrl) => {
  const imageModal = document.getElementById("imageViewerModal");
  const expandedImage = document.getElementById("expandedImageView");
  expandedImage.src = imageUrl;
  imageModal.classList.remove("hidden");
};

const closeImageViewer = () => {
  document.getElementById("imageViewerModal").classList.add("hidden");
};

// Initialize modal closing (put this at the end of your script)
document.addEventListener("DOMContentLoaded", () => {
  document.querySelector('.close-image-modal')?.addEventListener('click', closeImageViewer);
  document.getElementById('imageViewerModal')?.addEventListener('click', function(e) {
    if (e.target === this) closeImageViewer();
  });
});

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
    document.getElementById("profileDistance").value = userData.distance || "";
    document.getElementById("instagram").value = userData.instagram || ""; 
    document.getElementById("phone").value = userData.phone || "";
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
  const distance = parseInt(document.getElementById("profileDistance").value.trim()) || 0;

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

  // Check if distance has changed
  if (distance !== (userData.distance || 0)) { // Default to 0 if no distance is set
    updates.distance = distance;
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
  
    const user = auth.currentUser;          // Person making the offer
    const offeredPostId = dropdown.value;   // The post your user is offering
    const message = document.getElementById("swapMessage").value.trim();
  
    // 1. Create the offer in Firestore
    const offerRef = await addDoc(collection(db, "offers"), {
      fromUserId: user.uid,
      toUserId: (await getDoc(doc(db, "posts", targetPostId))).data().userId, 
      offeredPostId,
      targetPostId,
      message,
      status: "pending",
      timestamp: new Date(),
    });
  
    // 2. Send the user a Firestore notification
    const targetOwnerId = (await getDoc(doc(db, "posts", targetPostId))).data().userId;
  
    // Your content text can be anything you want:
    await addNotification(targetOwnerId, {
      type: "newOffer",             // <--- KEY PART: "newOffer"
      content: `${user.displayName || "Someone"} sent you a new offer!`,
      link: `https://life-swap-6065e.web.app/explore.html?offer=${offerRef.id}`, 
      // e.g., link to a page or anchor where they can see details
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

  let hasValidYourOffers = false;
  let hasValidReceivedOffers = false;

  // Display "Your Offers"
  yourOffersDiv.innerHTML = "";
  for (const offerDoc of yourOffersSnapshot.docs) {
    const offer = offerDoc.data();

    const targetPost = await getDoc(doc(db, "posts", offer.targetPostId));
    const offeredPost = await getDoc(doc(db, "posts", offer.offeredPostId));

    if (!targetPost.exists() || !offeredPost.exists()) continue;

    hasValidYourOffers = true;

    const targetPostTitle = targetPost.data().title;
    const offeredPostTitle = offeredPost.data().title;

    const dealQuery = query(collection(db, "deals"), where("offerId", "==", offerDoc.id));
    const dealSnapshot = await getDocs(dealQuery);

    let dealStatus = "Offer pending.";
    let actionButton = `<button class="cancel-offer-btn" onclick="cancelOffer('${offerDoc.id}')">Cancel Offer</button>`;
    let rateButton = "";
    let deleteButton = "";

    if (offer.status === "declined") {
      dealStatus = "Offer declined.";
      actionButton = `<button class="cancel-offer-btn" onclick="cancelOffer('${offerDoc.id}')">Remove Offer</button>`;
    } else if (!dealSnapshot.empty) {
      const deal = dealSnapshot.docs[0].data();
      const dealId = dealSnapshot.docs[0].id;

      if (deal.status === "closed") {
        dealStatus = "Deal closed. Thank you!";
        actionButton = ""; // No action needed after deal closure
        rateButton = `<button class="rate-btn" onclick="openRatingModal('${dealId}')">Rate User</button>`;
        deleteButton = `<button class="delete-offer-btn" onclick="deleteOffer('${dealId}')">Delete Offer</button>`;
      } else if (deal.status === "active") {
        dealStatus = "Deal accepted. Start chatting!";
        actionButton = `<button class="chat-btn" onclick="openChat('${dealId}')">Open Chat</button>`;

        // Keep the "Cancel Offer" button visible if the user sent the offer
        if (user.uid === offer.fromUserId) {
          actionButton += `
            <button class="cancel-offer-btn" onclick="cancelOffer('${offerDoc.id}')">
              Cancel Offer
            </button>`;
        }
      }
    }

    yourOffersDiv.innerHTML += `
      <div class="offer-item">
        <p><strong>Offered for:</strong> <a href="#" onclick="viewDetails('${offer.targetPostId}', true)">${targetPostTitle}</a></p>
        <p><strong>Your Offered Item:</strong> <a href="#" onclick="viewDetails('${offer.offeredPostId}', true)">${offeredPostTitle}</a></p>
        <p>${dealStatus}</p>
        ${actionButton}
        ${rateButton}
        ${deleteButton}
      </div>
    `;
  }

  if (!hasValidYourOffers) {
    yourOffersDiv.innerHTML = "<p>No offers yet.</p>";
  }

  // Display "Offers You Received"
  offersReceivedDiv.innerHTML = "";
  for (const offerDoc of offersReceivedSnapshot.docs) {
    const offer = offerDoc.data();

    const offeredPost = await getDoc(doc(db, "posts", offer.offeredPostId));
    const targetPost = await getDoc(doc(db, "posts", offer.targetPostId));

    if (!offeredPost.exists() || !targetPost.exists()) continue;

    hasValidReceivedOffers = true;

    const offeredPostTitle = offeredPost.data().title;
    const targetPostTitle = targetPost.data().title;

    const fromUser = await getDoc(doc(db, "users", offer.fromUserId));
    const fromUserName = fromUser.exists() ? fromUser.data().name : "Unknown User";

    const dealQuery = query(collection(db, "deals"), where("offerId", "==", offerDoc.id));
    const dealSnapshot = await getDocs(dealQuery);

    let dealStatus = "Offer pending.";
    let actionButton = `<button class="accept-btn" onclick="acceptOffer('${offerDoc.id}', this)">Accept</button>`;
    let declineButton = `<button class="decline-btn" onclick="declineOffer('${offerDoc.id}')">Decline</button>`;
    let rateButton = "";
    let deleteButton = "";

    if (offer.status === "declined") {
      dealStatus = "You declined this offer.";
      actionButton = "";
      declineButton = "";
    } else if (!dealSnapshot.empty) {
      const deal = dealSnapshot.docs[0].data();
      const dealId = dealSnapshot.docs[0].id;

      if (deal.status === "closed") {
        dealStatus = "Deal closed. Thank you!";
        actionButton = "";
        declineButton = "";
        rateButton = `<button class="rate-btn" onclick="openRatingModal('${dealId}')">Rate User</button>`;
        deleteButton = `<button class="delete-offer-btn" onclick="deleteOffer('${dealId}')">Delete Offer</button>`;
      } else if (deal.status === "active") {
        dealStatus = "Deal accepted. Start chatting!";
        actionButton = `<button class="chat-btn" onclick="openChat('${dealId}')">Open Chat</button>`;
      }
    }

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
        ${deleteButton}
        ${declineButton}
      </div>
    `;
  }

  if (!hasValidReceivedOffers) {
    offersReceivedDiv.innerHTML = "<p>No received offers yet.</p>";
  }
}

async function cancelOffer(offerId) {
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');
  
  if (confirm("Are you sure you want to cancel this offer? This action cannot be undone.")) {
    try {
      loadingOverlay.style.display = 'flex';
      loadingText.textContent = 'Initializing cancellation...';

      // Fetch the offer document
      const offerDoc = await getDoc(doc(db, "offers", offerId));
      if (!offerDoc.exists()) {
        loadingOverlay.style.display = 'none';
        alert("Offer not found. It may have already been removed.");
        return;
      }

      const offer = offerDoc.data();

      // Delete the offer document
      loadingText.textContent = 'Deleting offer...';
      await deleteDoc(doc(db, "offers", offerId));

      // Check if there is an associated chat for this offer
      loadingText.textContent = 'Checking for associated chats...';
      const dealQuery = query(collection(db, "deals"), where("offerId", "==", offerId));
      const dealSnapshot = await getDocs(dealQuery);

      if (!dealSnapshot.empty) {
        const deal = dealSnapshot.docs[0];
        const dealId = deal.id;

        // Fetch chat messages for this deal
        loadingText.textContent = 'Deleting chat messages...';
        const messagesQuery = collection(db, "chats", dealId, "messages");
        const messagesSnapshot = await getDocs(messagesQuery);

        const batch = writeBatch(db);
        for (const messageDoc of messagesSnapshot.docs) {
          const message = messageDoc.data();

          // Delete associated files from Firebase Storage
          loadingText.textContent = 'Cleaning up media files...';
          if (message.imageUrl) {
            try {
              const imageRef = ref(storage, message.imageUrl);
              await deleteObject(imageRef);
            } catch (error) {
              console.error("Error deleting image:", error);
            }
          }
          if (message.voiceUrl) {
            try {
              const voiceRef = ref(storage, message.voiceUrl);
              await deleteObject(voiceRef);
            } catch (error) {
              if (error.code === "storage/object-not-found") {
                console.warn("Voice file not found, skipping:", message.voiceUrl);
              } else {
                console.error("Error deleting voice file:", error);
              }
            }
          }

          batch.delete(messageDoc.ref);
        }

        // Commit batch deletion for messages
        loadingText.textContent = 'Finalizing chat deletion...';
        await batch.commit();

        // Delete the deal document
        await deleteDoc(deal.ref);
      }

      // Notify the other user about the canceled offer
      loadingText.textContent = 'Sending notification...';
      const otherUserId = offer.toUserId;
      await addNotification(otherUserId, {
        type: "offerCanceled",
        content: `The offer for your post has been canceled by the user.`,
        link: `https://life-swap-6065e.web.app/explore`,
      });

      loadingOverlay.style.display = 'none';
      alert("Offer and associated chat deleted successfully.");
      loadOffers();
    } catch (error) {
      loadingOverlay.style.display = 'none';
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
    link: `https://life-swap-6065e.web.app/explore.html?chat=${dealId}`,
  });

  await addNotification(offer.toUserId, {
    type: "offerAccepted",
    content: `You accepted ${fromUserName}'s offer. You can now chat.`,
    link: `https://life-swap-6065e.web.app/explore.html?chat=${dealId}`,
  });

  // Update the button to "Open Chat"
  buttonElement.outerHTML = `<button class="chat-btn" onclick="openChat('${dealId}')">Open Chat</button>`;
}

// Global variables for cleanup
let chatUnsubscribe = null;
let chatAbortController = null;

async function openChat(dealId) {
  // Cleanup previous chat session
  if (chatAbortController) {
    chatAbortController.abort();
  }
  if (chatUnsubscribe) {
    chatUnsubscribe();
  }

  // Initialize new cleanup controller
  chatAbortController = new AbortController();
  const signal = chatAbortController.signal;

  const chatModal = document.getElementById("chatModal");
  const chatContainer = document.getElementById("chatContainer");
  const closeDealBtn = document.getElementById("closeDealBtn");
  const imageInput = document.getElementById("imageInput");
  const recordButton = document.getElementById("recordButton");

  // Image click handling (using event delegation)
  chatContainer.addEventListener('click', (e) => {
    const img = e.target.closest('.chat-image');
    if (img) {
      const modal = document.getElementById('imageModal');
      const modalImg = document.getElementById('expandedImage');
      modal.classList.remove('hidden');
      modalImg.src = img.src;
    }
  }, { signal });

// Add modal close handling
document.querySelector('.close-modal').addEventListener('click', () => {
  document.getElementById('imageModal').classList.add('hidden');
}, { signal });

  let mediaRecorder;
  let audioChunks = [];

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

  // Real-time message listener with proper cleanup
  const messagesQuery = query(collection(db, "chats", dealId, "messages"), orderBy("timestamp"));
  chatUnsubscribe = onSnapshot(messagesQuery, async (snapshot) => {
    chatContainer.innerHTML = "";
    const currentUser = auth.currentUser;

    for (const doc of snapshot.docs) {
      const msg = doc.data();
      const senderName = await fetchUserName(msg.senderId);
      const formattedTimestamp = msg.timestamp
        ? new Date(msg.timestamp.toDate()).toLocaleString()
        : "Unknown Time";
      const isSender = currentUser && currentUser.uid === msg.senderId;
      const messageClass = isSender ? "sender-message" : "recipient-message";

      let messageContent = `
        <p class="${messageClass}">
          <strong>${senderName}:</strong>
      `;

      if (msg.message) {
        messageContent += `${msg.message}`;
      } else if (msg.imageUrl) {
        messageContent += `<br><img src="${msg.imageUrl}" alt="Image" class="chat-image" />`;
      } else if (msg.voiceUrl) {
        try {
          const voiceUrl = msg.voiceUrl.startsWith("https://")
            ? msg.voiceUrl
            : await getDownloadURL(ref(storage, msg.voiceUrl));
          messageContent += `<br><audio controls src="${voiceUrl}" class="chat-audio"></audio>`;
        } catch (error) {
          console.error("Error resolving voiceUrl:", error);
          messageContent += `<br><small>Error loading voice message</small>`;
        }
      }

      messageContent += `<br><small>${formattedTimestamp}</small></p>`;
      chatContainer.innerHTML += messageContent;
    }
  });

  // Close deal button handling
  if (deal.status === "active") {
    closeDealBtn.classList.remove("hidden");
    closeDealBtn.onclick = () => closeDeal(dealId);
  } else {
    closeDealBtn.classList.add("hidden");
  }

  chatModal.classList.remove("hidden");

  // Notification handler
  async function handleMessageNotification(content) {
    try {
      const updatedDealSnapshot = await getDoc(dealRef);
      if (!updatedDealSnapshot.exists()) return;

      const updatedDeal = updatedDealSnapshot.data();
      const currentUserId = auth.currentUser.uid;
      const otherUserId = updatedDeal.fromUserId === currentUserId 
        ? updatedDeal.toUserId 
        : updatedDeal.fromUserId;

      const senderDoc = await getDoc(doc(db, "users", currentUserId));
      const senderName = senderDoc.exists() ? senderDoc.data().name : "Unknown User";

      await addNotification(otherUserId, {
        type: "newMessage",
        content: `${senderName} sent you: ${content}`,
        link: `https://life-swap-6065e.web.app/explore.html?chat=${dealId}`,
      });
    } catch (error) {
      console.error("Error handling notification:", error);
    }
  }

  // Image handling with cleanup
  document.getElementById("imageButton").addEventListener("click", 
    () => imageInput.click(), 
    { signal }
  );

// Modified image handling in openChat function
imageInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const user = auth.currentUser;
    
    // Use your existing compression function
    const compressedFile = await compressImage(file);
    
    const imagePath = `chatImages/${user.uid}/${Date.now()}_${file.name}`;
    const imgRef = ref(storage, imagePath);
    
    // Upload compressed image instead of original
    const snapshot = await uploadBytes(imgRef, compressedFile);
    const downloadURL = await getDownloadURL(snapshot.ref);

    await addDoc(collection(db, "chats", dealId, "messages"), {
      senderId: user.uid,
      imageUrl: downloadURL,
      timestamp: new Date(),
    });

    await handleMessageNotification("an image");
  } catch (error) {
    console.error("Error handling image:", error);
    alert("Failed to send image.");
  }
}, { signal });

  // Voice recording with cleanup
  const handleRecording = async () => {
    if (mediaRecorder?.state === "recording") {
      mediaRecorder.stop();
      recordButton.textContent = "🎤";
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.start();
      recordButton.textContent = "⏹️";

      mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        try {
          const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
          audioChunks = [];
          const user = auth.currentUser;
          const audioPath = `voiceMessages/${user.uid}/${Date.now()}.webm`;
          const audioRef = ref(storage, audioPath);

          const snapshot = await uploadBytes(audioRef, audioBlob);
          const downloadURL = await getDownloadURL(snapshot.ref);

          await addDoc(collection(db, "chats", dealId, "messages"), {
            senderId: user.uid,
            voiceUrl: downloadURL,
            timestamp: new Date(),
          });

          await handleMessageNotification("a voice message");
        } finally {
          stream.getTracks().forEach(track => track.stop());
        }
      };
    } catch (error) {
      alert("Microphone access required!");
    }
  };

  recordButton.addEventListener("click", handleRecording, { signal });

  // Text messages with cleanup
  const handleSubmit = async (e) => {
    e.preventDefault();
    const message = document.getElementById("chatMessage").value.trim();
    if (!message) return;

    try {
      await addDoc(collection(db, "chats", dealId, "messages"), {
        senderId: auth.currentUser.uid,
        message,
        timestamp: new Date(),
      });

      document.getElementById("chatMessage").value = "";
      await handleMessageNotification(`"${message.substring(0, 30)}${message.length > 30 ? '...' : ''}"`);
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  document.getElementById("chatForm").addEventListener("submit", handleSubmit, { signal });
}

function closeChat() {
  document.getElementById("chatModal").classList.add("hidden");
  
  // Cleanup resources
  if (chatAbortController) {
    chatAbortController.abort();
    chatAbortController = null;
  }
  
  if (chatUnsubscribe) {
    chatUnsubscribe();
    chatUnsubscribe = null;
  }
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
      loadOffers(); // Refresh the offers list to show the "Rate User" and "Delete Offer" buttons
    } else {
      alert("Waiting for the other party to confirm.");
    }
  } else {
    alert("You have already confirmed this deal.");
  }
}

async function deleteOffer(dealId) {
  if (confirm("Are you sure you want to delete this offer and the associated posts? This action cannot be undone.")) {
    try {
      const dealRef = doc(db, "deals", dealId);
      const dealSnapshot = await getDoc(dealRef);

      if (!dealSnapshot.exists()) {
        alert("Deal not found!");
        return;
      }

      const deal = dealSnapshot.data();

      // 1. Delete the deal document
      await deleteDoc(dealRef);

      // 2. Delete the associated posts
      const offeredPostRef = doc(db, "posts", deal.offeredPostId);
      const targetPostRef = doc(db, "posts", deal.postId);

      await deleteDoc(offeredPostRef);
      await deleteDoc(targetPostRef);

      // 3. Delete the chat messages for this deal
      const messagesQuery = collection(db, "chats", dealId, "messages");
      const messagesSnapshot = await getDocs(messagesQuery);

      const batch = writeBatch(db); // Batch write for efficiency
      for (const messageDoc of messagesSnapshot.docs) {
        const message = messageDoc.data();

        // Delete associated files (images, voice messages) from Firebase Storage
        if (message.imageUrl) {
          const imageRef = ref(storage, message.imageUrl.replace(/.*\/o\/(.*)\?alt=.*/, "$1"));
          await deleteObject(imageRef);
        }
        if (message.voiceUrl) {
          const voiceRef = ref(storage, message.voiceUrl); // Use relative path directly
          try {
            await deleteObject(voiceRef);
          } catch (error) {
            if (error.code === "storage/object-not-found") {
              console.warn("Voice file not found, skipping:", message.voiceUrl);
            } else {
              console.error("Error deleting voice file:", error);
            }
          }
        }

        // Add message deletion to batch
        batch.delete(messageDoc.ref);
      }

      // Commit batch deletion for messages
      await batch.commit();

      // 4. Also delete the original offer(s) that led to this deal
      const offerQuery = query(
        collection(db, "offers"),
        where("targetPostId", "==", deal.postId),
        where("offeredPostId", "==", deal.offeredPostId)
      );
      const offerSnapshot = await getDocs(offerQuery);

      for (const singleOfferDoc of offerSnapshot.docs) {
        await deleteDoc(singleOfferDoc.ref);
      }

      alert("Offer, associated posts, and chat messages deleted successfully.");
      loadOffers(); // Refresh the offers list
    } catch (error) {
      console.error("Error deleting offer:", error);
      alert("Failed to delete the offer. Please try again.");
    }
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
    let notificationContent = `${senderName} sent you a message`;
  
    if (message) {
      notificationContent = `${senderName} sent you a message: "${message.substring(0, 30)}..."`;
    } else if (imageUrl) {
      notificationContent = `${senderName} sent you an image.`;
    } else if (voiceUrl) {
      notificationContent = `${senderName} sent you a voice message.`;
    }
  
    await addNotification(otherUserId, {
      type: "newMessage",
      content: notificationContent,
      link: `https://life-swap-6065e.web.app/explore.html?chat=${dealId}`,
    });
  
    console.log("Notification successfully added.");
  } catch (error) {
    console.error("Failed to add notification:", error);
  }
}

// Add a "Clear Results" button
const form = document.getElementById('chat-form');
const userMessageInput = document.getElementById('user-message');
const responseContainer = document.getElementById('response');
const clearResultsButton = document.getElementById('clear-results'); // Reference the existing button
const viewDetailsButton = `<button type="button" class="view-details">View Details</button>`;

// Add click event listener to the Clear Results button
clearResultsButton.addEventListener('click', () => {
  responseContainer.innerHTML = ''; // Clear the results
  userMessageInput.value = ''; // Clear the input field
  clearResultsButton.style.display = 'none'; // Hide the button after clearing
});

// Add event delegation for dynamically created "View Details" buttons
responseContainer.addEventListener('click', (event) => {
  if (event.target.classList.contains('view-details')) {
    event.preventDefault(); // Prevent default behavior (e.g., form submission)
    const postId = event.target.dataset.postId; // Get post ID from data attribute
    viewDetails(postId); // Call the viewDetails function
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const userMessage = userMessageInput.value.trim();
  const userId = auth.currentUser.uid; // Get the userId of the logged-in user

  if (!userId) {
    alert('You must be logged in to use this feature.');
    return;
  }

  if (!userMessage) {
    alert('Please enter a message.');
    return;
  }

  const firebaseFunctionUrl = 'https://us-central1-life-swap-6065e.cloudfunctions.net/chatSearch'; // Replace with your function URL

  try {
    const response = await fetch(firebaseFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: userMessage, userId: userId }), // Include userId here
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    responseContainer.innerHTML = `<p>${data.message}</p>`;
    if (data.posts && data.posts.length > 0) {
      const postsList = data.posts.map(post => `
        <div class="post-details">
          <h3 class="post-title">${post.title}</h3>
          ${post.imageUrls && post.imageUrls.length > 0 ? `
            <img src="${post.imageUrls[0]}" alt="${post.title}" class="ai-image" />
          ` : ''}
          <p class="post-description">${post.description}</p>
          <p class="post-desired-trade">💡 <strong>Desired Trade:</strong> ${post.desiredTrade || "Not specified"}</p>
          <p class="post-location">📌 ${post.city}, Distance: ${post.distanceFromCity} miles</p>
          <button type="button" class="view-details" data-post-id="${post.id}">View Details</button>
        </div>
      `).join('');
      responseContainer.innerHTML += `<h2>✨ Swap AI Suggestions:</h2>${postsList}`;
    }

    // Show the "Clear Results" button
    clearResultsButton.style.display = 'block';
  } catch (error) {
    responseContainer.innerHTML = `<p>Error: ${error.message}</p>`;
  }
});

async function getIdToken() {
  const user = auth.currentUser; // Use the initialized `auth` object
  if (user) {
    return await user.getIdToken();
  } else {
    console.warn("User is not authenticated.");
    return null;
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
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');
  
  try {
    loadingOverlay.style.display = 'flex';
    loadingText.textContent = 'Checking offer status...';

    // Fetch the offer document
    const offerDoc = await getDoc(doc(db, "offers", offerId));
    if (!offerDoc.exists()) {
      loadingOverlay.style.display = 'none';
      alert("Offer not found. It may have already been removed.");
      return;
    }

    const offer = offerDoc.data();

    // Check if the deal is already closed by both users
    loadingText.textContent = 'Checking for existing deals...';
    const dealQuery = query(collection(db, "deals"), where("offerId", "==", offerId));
    const dealSnapshot = await getDocs(dealQuery);

    if (!dealSnapshot.empty) {
      const deal = dealSnapshot.docs[0].data();
      const dealId = dealSnapshot.docs[0].id;

      if (deal.status === "closed") {
        loadingOverlay.style.display = 'none';
        alert("You can't decline this offer once both have closed it. Please delete or rate the offer.");
        return;
      }

      // Fetch chat messages for this deal
      loadingText.textContent = 'Deleting chat messages...';
      const messagesQuery = collection(db, "chats", dealId, "messages");
      const messagesSnapshot = await getDocs(messagesQuery);

      const batch = writeBatch(db);
      for (const messageDoc of messagesSnapshot.docs) {
        const message = messageDoc.data();

        // Delete associated files from Firebase Storage
        loadingText.textContent = 'Deleting media files...';
        if (message.imageUrl) {
          try {
            const imageRef = ref(storage, message.imageUrl);
            await deleteObject(imageRef);
          } catch (error) {
            console.error("Error deleting image:", error);
          }
        }
        if (message.voiceUrl) {
          try {
            const voiceRef = ref(storage, message.voiceUrl);
            await deleteObject(voiceRef);
          } catch (error) {
            console.error("Error deleting voice message:", error);
          }
        }

        batch.delete(messageDoc.ref);
      }

      // Commit batch deletion for messages
      loadingText.textContent = 'Finalizing deletions...';
      await batch.commit();

      // Delete the deal document
      await deleteDoc(doc(db, "deals", dealId));
    }

    const fromUserId = offer.fromUserId;

    // Fetch the sender's name
    loadingText.textContent = 'Fetching user information...';
    const fromUserDoc = await getDoc(doc(db, "users", fromUserId));
    const fromUserName = fromUserDoc.exists() ? fromUserDoc.data().name : "Unknown User";

    // Fetch the current user's name from Firestore
    const currentUserRef = doc(db, "users", auth.currentUser.uid);
    const currentUserDoc = await getDoc(currentUserRef);
    const currentUserName = currentUserDoc.exists() ? currentUserDoc.data().name : "Unknown User";

    // Fetch the target post title
    loadingText.textContent = 'Fetching post details...';
    const targetPostDoc = await getDoc(doc(db, "posts", offer.targetPostId));
    const targetPostTitle = targetPostDoc.exists() ? targetPostDoc.data().title : "Unknown Post";

    // Delete the offer document
    loadingText.textContent = 'Removing offer...';
    await deleteDoc(doc(db, "offers", offerId));

    // Notify the sender about the declined offer
    loadingText.textContent = 'Sending notification...';
    await addNotification(fromUserId, {
      type: "offerDeclined",
      content: `${currentUserName} declined your offer for "${targetPostTitle}".`,
      link: `https://life-swap-6065e.web.app/explore`,
    });

    loadingOverlay.style.display = 'none';
    alert(`You declined an offer from ${fromUserName}, and associated chats were deleted if they existed.`);
    loadOffers();
  } catch (error) {
    loadingOverlay.style.display = 'none';
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

async function loadPostsToMap(map, filterType = "", filterHashtags = [], filterCategory = "", mapBounds) { 
  if (!map) {
    console.error("Map is not initialized.");
    return;
  }

  const currentZoom = map.getZoom();
  if (currentZoom < MIN_ZOOM_LEVEL) {
    postMarkersGroup.clearLayers();
    return;
  }

  const bounds = map.getBounds();
  const southwest = bounds.getSouthWest();
  const northeast = bounds.getNorthEast();

  // Construct the query
  let postsQuery = collection(db, "posts");
  const conditions = [];

  if (filterType) conditions.push(where("type", "==", filterType));
  if (filterCategory) conditions.push(where("category", "==", filterCategory));
  if (filterHashtags.length > 0) conditions.push(where("hashtags", "array-contains-any", filterHashtags));

  conditions.push(where("latitude", ">=", southwest.lat));
  conditions.push(where("latitude", "<=", northeast.lat));
  conditions.push(where("longitude", ">=", southwest.lng));
  conditions.push(where("longitude", "<=", northeast.lng));
  conditions.push(orderBy("timestamp", "desc"));

  postsQuery = query(postsQuery, ...conditions);
  const postsSnapshot = await getDocs(postsQuery);

  postMarkersGroup.clearLayers();

  const locationPostsMap = {};
  postsSnapshot.forEach((doc) => {
    const post = doc.data();
    if (post.latitude && post.longitude) {
      const locationKey = `${post.latitude},${post.longitude}`;
      locationPostsMap[locationKey] = locationPostsMap[locationKey] || [];
      locationPostsMap[locationKey].push({ ...post, id: doc.id });
    }
  });

  // Create markers with jittered positions
  Object.keys(locationPostsMap).forEach((locationKey) => {
    const [originalLat, originalLng] = locationKey.split(",").map(Number);
    const posts = locationPostsMap[locationKey];
    const postCount = posts.length;

    posts.forEach((post, index) => {
      // Apply jitter only if multiple posts exist at this location
      let jitteredLat = originalLat;
      let jitteredLng = originalLng;
      if (postCount > 1) {
        const angle = (index * (2 * Math.PI)) / postCount;
        const radius = 0.0002; // Adjust radius for spread (~20 meters)
        jitteredLat += radius * Math.cos(angle);
        jitteredLng += radius * Math.sin(angle);
      }

      // Create marker with default icon
      const marker = L.marker([jitteredLat, jitteredLng], {
        title: post.title // This adds basic hover text
      });

      // Add permanent tooltip with custom styling
      marker.bindTooltip(post.title, {
        permanent: true,
        direction: "top",
        offset: [-15, -5], // Position above the pin
        className: `map-pin-title ${postCount > 1 ? 'multi-item-title' : ''}`
      });

      // Add popup with custom class
      marker.bindPopup(`
        <div class="map-post-popup">
          <h3>${post.title}</h3>
          <strong>Desired Trade:</strong> ${post.desiredTrade || "Not specified"}
          <button class="btn-view-details" onclick="viewDetails('${post.id}')">
            View Details
          </button>
        </div>
      `);

      postMarkersGroup.addLayer(marker);
    });
  });
}

let suppressFetchOnce = false;

function centerMapOnUserLocation(map) {
  const recenterButton = document.createElement("button");
  recenterButton.textContent = "📍";
  recenterButton.style.cssText = `
    position: absolute;
    top: 80px;
    left: 10px;
    z-index: 1000;
    padding: 10px;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 5px;
    cursor: pointer;
  `;

  // Track both marker and accuracy circle
  let userLocationMarker = null;
  let accuracyCircle = null;

  recenterButton.onclick = () => {
    if (navigator.geolocation) {
      recenterButton.textContent = "⌛";
      recenterButton.disabled = true;

      const geoOptions = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;

          // Remove previous elements
          if (userLocationMarker) {
            map.removeLayer(userLocationMarker);
          }
          if (accuracyCircle) {
            map.removeLayer(accuracyCircle);
          }

          // Create new accuracy circle
          accuracyCircle = L.circle([latitude, longitude], {
            color: '#135aac',
            fillColor: '#135aac',
            fillOpacity: 0.3, // Increased opacity
            weight: 2, // Added border thickness
            radius: accuracy
          }).addTo(map);

          // Create new marker
          userLocationMarker = L.marker([latitude, longitude])
            .bindPopup(`<b>Your location</b><br>Accuracy: ${Math.round(accuracy)} meters`)
            .addTo(map)
            .openPopup();

          // Ensure MIN_ZOOM_LEVEL is defined (e.g., const MIN_ZOOM_LEVEL = 12;)
          const targetZoom = Math.min(
            Math.max(16 - Math.log2(accuracy/50), MIN_ZOOM_LEVEL),
            18
          );

          map.flyTo([latitude, longitude], targetZoom, {
            animate: true,
            duration: 1.5
          });

          recenterButton.textContent = "📍";
          recenterButton.disabled = false;
        },
        (error) => {
          console.error("Geolocation error:", error);
          alert(`Location error: ${error.message}`);
          recenterButton.textContent = "📍";
          recenterButton.disabled = false;
        },
        geoOptions
      );
    } else {
      alert("Geolocation is not supported by your browser.");
    }
  };

  document.getElementById("map").appendChild(recenterButton);
}

document.getElementById("getLocationButton").addEventListener("click", () => {
  const latitudeField = document.getElementById("latitude");
  const longitudeField = document.getElementById("longitude");
  const loadingIndicator = document.getElementById("locationLoading");
  const button = document.getElementById("getLocationButton");

  if (navigator.geolocation) {
    // Show loading state
    loadingIndicator.style.display = "flex";
    button.disabled = true;
    button.textContent = "Fetching location...";

    const successHandler = (position) => {
      const { latitude, longitude } = position.coords;
      latitudeField.value = latitude;
      longitudeField.value = longitude;
      
      // Hide loading state
      loadingIndicator.style.display = "none";
      button.disabled = false;
      button.textContent = "📍 Click here to add your current location";
    };

    const errorHandler = (error) => {
      console.error("Geolocation error:", error);
      alert("Failed to get your location. Make sure you allow location access.");
      
      // Hide loading state
      loadingIndicator.style.display = "none";
      button.disabled = false;
      button.textContent = "📍 Click here to add your current location";
    };

    // Clear any previous geolocation attempts
    if (window.geolocationTimeout) {
      clearTimeout(window.geolocationTimeout);
    }

    // Add timeout fallback
    window.geolocationTimeout = setTimeout(() => {
      errorHandler({ code: 3, message: "Geolocation timed out" });
    }, 10000);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(window.geolocationTimeout);
        successHandler(position);
      },
      (error) => {
        clearTimeout(window.geolocationTimeout);
        errorHandler(error);
      },
      { enableHighAccuracy: true, timeout: 9500 }
    );
  } else {
    alert("Geolocation is not supported by your browser.");
  }
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
window.filterByHashtag = filterByHashtag;
window.deleteOffer= deleteOffer;
